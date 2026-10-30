/** Display-only protocol recognition; never changes the inputs authorized for signing. */
import { crypto, opcodes, script } from 'bitcoinjs-lib';
import { tapleafHash, tweakKey } from 'bitcoinjs-lib/src/payments/bip341';
import { Buffer } from 'buffer';
import { get_vault_terms } from '@ducat-unit/core/lib';
import type { DucatVaultReturnData, PsbtOutputSummary, VaultDisplayProtocol, WalletAccountRecord } from './types';

const NUMS_KEY = Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex');

export function vaultDisplayProtocol(proto: unknown, assetId: string): VaultDisplayProtocol | undefined {
  try {
    const profile = proto as {
      proto_members: { group: number; idx: number; pubkey: string }[];
      proto_assets: { id: string; div: number }[];
      proto_terms: unknown[];
    };
    const guardians = profile.proto_members.filter(({ group }) => group === 21)
      .map(({ idx, pubkey }) => ({ index: idx, pubkey }));
    const minimumSats = get_vault_terms(profile.proto_terms).vault_value_min;
    const unitDivisibility = profile.proto_assets.find((asset) => asset.id === assetId)?.div;
    if (guardians.length > 256 || guardians.some(({ index, pubkey }) => !Number.isInteger(index)
      || index < 0 || index > 255 || !/^[a-f0-9]{64}$/iu.test(pubkey))
      || new Set(guardians.map(({ index }) => index)).size !== guardians.length
      || !Number.isSafeInteger(minimumSats) || minimumSats < 0
      || unitDivisibility === undefined || !Number.isInteger(unitDivisibility)
      || unitDivisibility < 0 || unitDivisibility > 8) return undefined;
    return { guardians, minimumSats, unitDivisibility };
  } catch {
    return undefined;
  }
}

/** Mirrors client-sdk's sorted, duplicate-odd Taproot tree, using bitcoinjs hashes. */
export function vaultOutputScript(clientPubkey: string, guardians: string[], hashes: string[]): Buffer {
  const leaves = guardians.flatMap((guardian) => [
    script.compile([Buffer.from(clientPubkey, 'hex'), opcodes.OP_CHECKSIGVERIFY, Buffer.from(guardian, 'hex'), opcodes.OP_CHECKSIG]),
    ...hashes.map((hash) => script.compile([opcodes.OP_HASH160, Buffer.from(hash, 'hex'), opcodes.OP_EQUALVERIFY,
      Buffer.from(guardian, 'hex'), opcodes.OP_CHECKSIG])),
  ]);
  if (leaves.length < 1 || leaves.length > 12) throw new Error('Invalid vault tree');
  let nodes = leaves.map((output) => tapleafHash({ output, version: 0xc0 }));
  while (nodes.length > 1) {
    nodes.sort(Buffer.compare);
    if (nodes.length % 2) nodes.push(nodes[nodes.length - 1]);
    const next: Buffer[] = [];
    for (let i = 0; i < nodes.length; i += 2) next.push(crypto.taggedHash('TapBranch', Buffer.concat([nodes[i], nodes[i + 1]])));
    nodes = next;
  }
  const key = tweakKey(NUMS_KEY, nodes[0]);
  if (!key) throw new Error('Invalid vault key');
  return script.compile([opcodes.OP_1, Buffer.from(key.x)]);
}

/** Bind protocol state to the actual output script, not merely its position or app label. */
export function bindVaultOutput(
  data: DucatVaultReturnData,
  outputs: { value: number; script: Uint8Array }[],
  account: WalletAccountRecord,
  protocol?: VaultDisplayProtocol,
): void {
  if (!protocol || !data.guardianIndexes || !data.thresholdHashes) return;
  const index = data.actionType === 'create' || data.actionType === 'borrow' ? 1 : 0;
  const output = outputs[index];
  if (!output || data.actionType === 'close' || output.value < protocol.minimumSats) return;
  try {
    const guardians = data.guardianIndexes.map((id) => protocol.guardians.find((guard) => guard.index === id)?.pubkey);
    if (guardians.some((key) => key === undefined) || new Set(guardians).size !== guardians.length) return;
    const keys = guardians as string[];
    const expected = vaultOutputScript(account.vault.pubkey.slice(-64), keys, data.isLocked ? data.thresholdHashes : []);
    if (!expected.equals(Buffer.from(output.script))) return;
    data.vaultOutputIndex = index;
    data.collateralSats = output.value;
    data.collateralBalanceSats = output.value - protocol.minimumSats;
    data.unitBalanceUnit = data.unitBalanceCents / (10 ** protocol.unitDivisibility);
    data.guardianPubkeys = keys;
  } catch {
    // Unrecognized destinations retain the generic recipient review.
  }
}

/** Only the simple transfer-only Runestone shape emitted by the SDK is recognized. */
export function unitTransferEdicts(outputs: PsbtOutputSummary[], assetId: string, divisibility: number) {
  const stones = outputs.map((output) => script.decompile(Buffer.from(output.scriptHex, 'hex')))
    .filter((chunks) => chunks?.[0] === opcodes.OP_RETURN && chunks[1] === opcodes.OP_13);
  if (stones.length !== 1) return undefined;
  const chunks = stones[0]!;
  if (chunks.slice(2).some((chunk) => !Buffer.isBuffer(chunk))) return undefined;
  const payload = Buffer.concat(chunks.slice(2) as Buffer[]);
  const values: bigint[] = [];
  let value = 0n, shift = 0n;
  for (const byte of payload) {
    value |= BigInt(byte & 127) << shift;
    if (value >= (1n << 128n) || shift > 126n) return undefined;
    if (byte & 128) shift += 7n;
    else { values.push(value); value = 0n; shift = 0n; }
  }
  if (shift || values[0] !== 0n || (values.length - 1) % 4) return undefined;
  const transfers: { outputIndex: number; amountUnit: number; assetId: string }[] = [];
  let block = 0n, tx = 0n;
  for (let i = 1; i < values.length; i += 4) {
    const [blockDelta, txDelta, amount, output] = values.slice(i, i + 4);
    block += blockDelta; tx = blockDelta === 0n ? tx + txDelta : txDelta;
    if (block === 0n || tx > 0xffffffffn || output >= BigInt(outputs.length)
      || amount > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    const id = `${block}:${tx}`;
    if (id !== assetId) return undefined;
    transfers.push({ outputIndex: Number(output), amountUnit: Number(amount) / 10 ** divisibility, assetId: id });
  }
  return transfers;
}
