/** Reviews canonical recovery bytes and custody; ledger eligibility remains external. */
import { Transaction, script as btcScript, opcodes, type Psbt } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import {
  decode_vault_recovery_message, decode_vault_return_script, create_recovery_profile,
  verify_proto_profile, extract_vault_price_contracts, is_oracle_event_fresh,
} from '@ducat-unit/core/lib';
import { ducatError } from './errors';
import { getEffectiveNetworkProfile } from './network-profiles';
import type { AccountPublicSet } from './accounts';
import type { PsbtSummary } from './types';

function reject(message: string): never {
  throw ducatError('PSBT_RECOVERY_MISMATCH', message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('Recovery evidence must be an object.');
  return value as Record<string, unknown>;
}
function recoveryEnvelope(outputs: { script: Buffer }[]): Buffer | null {
  const vault = outputs.filter(output => output.script[0] === opcodes.OP_RETURN && output.script[1] === opcodes.OP_8);
  const candidates = vault.filter(output => {
    const chunks = btcScript.decompile(output.script);
    return chunks && Buffer.isBuffer(chunks[2]) && chunks[2][0] === 0x12;
  });
  if (candidates.length === 0) return null;
  if (candidates.length !== 1 || vault.length !== 1) reject('Recovery must contain exactly one vault envelope.');
  return candidates[0].script;
}

/** Called only after the ordinary input ownership and external prevout checks. */
export async function verifyRecoveryReview(
  psbt: Psbt, summary: PsbtSummary, account: AccountPublicSet, returnContext?: unknown,
  dependencies: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<void> {
  const envelope = recoveryEnvelope(psbt.txOutputs);
  if (!envelope && returnContext === undefined) return;
  const profile = await getEffectiveNetworkProfile(summary.network);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  async function json(path: string): Promise<unknown> {
    const response = await fetchImpl(`${profile.validator_base_url}${path}`, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) reject('Recovery protocol verification is unavailable.');
    return response.json();
  }
  let outputs: {script: Buffer; value: number}[] = psbt.txOutputs;
  let source = envelope;
  let parentTxid: string | undefined;
  if (returnContext !== undefined) {
    const context = record(returnContext);
    if (envelope || Object.keys(context).length !== 2 || context.action !== 'return' || typeof context.parentTx !== 'string' ||
      !/^(?:[0-9a-f]{2})+$/u.test(context.parentTx) || context.parentTx.length > 8_000_000) reject('Invalid recovery-return review context.');
    let parent: Transaction;
    try { parent = Transaction.fromHex(context.parentTx); } catch { reject('The recovery parent transaction is malformed.'); }
    parentTxid = parent.getId();
    if (psbt.txInputs.length !== 1 || psbt.txOutputs.length !== 1 ||
      Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex') !== parentTxid) reject('Return must spend only its exact recovery parent.');
    outputs = parent.outs;
    source = recoveryEnvelope(outputs);
    if (!source) reject('The parent does not contain a canonical recovery message.');
  }
  if (!source) reject('Missing recovery envelope.');
  const message = decode_vault_recovery_message(source.toString('hex'));
  const current = record(await json('/api/proto/latest'));
  verify_proto_profile(current);
  if (current.chain_network !== profile.expected_validator_chain_network) reject('Recovery protocol network mismatch.');
  let proto = current;
  if (message.contract_id !== current.contract_id) {
    if (envelope) reject('Repair must use the current protocol contract.');
    const history = await json('/api/proto/history');
    if (!Array.isArray(history) || history.length > 1000) reject('Recovery protocol history is unavailable.');
    const prior = history.find(item => record(item).contract_id === message.contract_id);
    if (!prior) reject('The parent protocol is no longer available for verification.');
    proto = record(prior);
    verify_proto_profile(proto);
    if (proto.anchor_id !== current.anchor_id || proto.chain_network !== current.chain_network) reject('Recovery parent deployment mismatch.');
  }
  if (message.client_pubkey !== account.vaultInternalPubkey.toString('hex')) reject('The replacement vault owner is not this Snap account.');
  const output = outputs[message.output_index];
  if (!output) reject('The recovery designates a missing output.');
  const terms = decode_vault_return_script(proto, message.vault_return_script);
  // This proves internal consistency with encoded debt, not an accepted ledger balance.
  const checked = create_recovery_profile(proto, message, { txid: parentTxid ?? '00'.repeat(32), vout: message.output_index,
    value: output.value, script_pk: output.script.toString('hex') },
  { root_txid: message.target_coin_id.split(':')[0], accepted_unit_debt: terms.unit_balance });
  if (outputs.filter(item => item.script.equals(output.script)).length !== 1) reject('Recovery contains ambiguous custody outputs.');
  if (envelope) {
    if (summary.unitInputs.length > 0 || summary.signedInputs.some(input => input.role !== 'sats') ||
      summary.signedInputIndexes.length !== psbt.txInputs.length) reject('Repair requires the selected BTC funding inputs.');
    for (const contract of extract_vault_price_contracts(proto, terms)) {
      if (!is_oracle_event_fresh(contract, 300, Math.floor((dependencies.now?.() ?? Date.now()) / 1000))) reject('Repair oracle commitments are stale or future-dated.');
    }
  } else {
    const input = summary.signedInputs[0];
    if (psbt.txInputs[0].index !== message.output_index || summary.signedInputs.length !== 1 || input.index !== 0 ||
      input.verification !== 'committed-ducat-cosign-leaf' || !checked.guard_members.includes(input.cosignGuardPubkey ?? '') ||
      !psbt.txOutputs[0].script.equals(account.satsOutputScript)) reject('Return custody or selected BTC destination mismatch.');
    const prevout = psbt.data.inputs[0].witnessUtxo;
    if (!prevout || prevout.value !== output.value || !prevout.script.equals(output.script)) reject('Return prevout differs from the designated recovery output.');
  }
  summary.recovery = { action: envelope ? 'repair' : 'return', targetOutpoint: message.target_coin_id,
    contractId: message.contract_id, replacementOwner: message.client_pubkey, guardians: checked.guard_members,
    encodedDebt: terms.unit_balance, collateralSats: output.value,
    ...(parentTxid ? { parentOutpoint: `${parentTxid}:${message.output_index}` } : {}) };
}
