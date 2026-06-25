import { address as btcAddress, crypto, opcodes, Psbt, script as btcScript, Transaction } from 'bitcoinjs-lib';
import { rootHashFromPath, tapleafHash, tweakKey } from 'bitcoinjs-lib/src/payments/bip341';
import { Buffer } from 'buffer';

import { type AccountKeySet, type AccountPublicSet, getNodeForRole, getOutputScriptForRole, getRoleForAddress } from './accounts';
import type { DucatKeyNode } from './bip32';
import { matchCosignLeafHex } from './cosign-leaf';
import { matchTimeoutLeafHex } from './timeout-leaf';
import { ducatError } from './errors';
import { bitcoinNetwork, guardianAllowlistEnforced, isKnownGuardianPubkey } from './networks';
import type {
  DucatAddressRole,
  DucatNetwork,
  DucatVaultActionFlag,
  DucatVaultReturnData,
  PsbtInputSummary,
  PsbtOutputSummary,
  PsbtSummary,
  SignInputs,
} from './types';

const TAPLEAF_VERSION_MASK = 0xfe;
const MAX_PSBT_BASE64_LENGTH = 350_000;
// The Snap only ever produces signatures that commit to every input and output. We pin the
// allowed sighash types explicitly instead of relying on bitcoinjs-lib's default arguments so a
// PSBT carrying SIGHASH_NONE/SINGLE/ANYONECANPAY is rejected before the confirmation dialog.
const ALLOWED_ECDSA_SIGHASH_TYPES = [Transaction.SIGHASH_ALL];
const ALLOWED_TAPROOT_SIGHASH_TYPES = [Transaction.SIGHASH_DEFAULT, Transaction.SIGHASH_ALL];
const MAX_PSBT_INPUTS = 80;
const MAX_PSBT_OUTPUTS = 120;
// The confirmation dialog itemizes the first VISIBLE_OUTPUT_FOLD non-data outputs
// (confirmations.ts renders recipientOutputs.slice(0, 8) in transaction order). We reject any
// PSBT where an external recipient would fall outside that visible slice rather than silently
// collapsing it into the hidden-output aggregate (SAY-07), so every destination a user signs
// over is itemized. This must stay in sync with the slice size in confirmations.ts.
const VISIBLE_OUTPUT_FOLD = 8;
const DUCAT_VAULT_RETURN_VERSION = 1;
const DUCAT_VAULT_RETURN_MIN_SIZE = 14;
const DUCAT_VAULT_RETURN_LOCKED_SIZE = 38;
const DUCAT_PRICE_COMMIT_SIZE = 93;
const DUCAT_MAX_GUARD_COUNT = 3;
const DUCAT_MAX_ORACLE_COUNT = 3;
const SEQUENCE_TIMELOCK_DISABLE = 0x80000000;
const SEQUENCE_METADATA_SIGNAL = 0x40000000;
const SEQUENCE_METADATA_DISABLE = 0x20000000;
const SEQUENCE_METADATA_SHORT_MASK = 0xffff;
const SEQUENCE_METADATA_BYTE_MASK = 0xff;
const DUCAT_VAULT_SEQUENCE_VERSION = 1;
const DUCAT_VAULT_ACTION_CODES: Record<
  number,
  { actionFlag: DucatVaultActionFlag; actionType: string; protocolAction: string; vaultOutputIndex: number }
> = {
  161: { actionFlag: 'o', actionType: 'create', protocolAction: 'open', vaultOutputIndex: 2 },
  163: { actionFlag: 'c', actionType: 'close', protocolAction: 'close', vaultOutputIndex: -1 },
  164: { actionFlag: 'b', actionType: 'borrow', protocolAction: 'borrow', vaultOutputIndex: 1 },
  165: { actionFlag: 'r', actionType: 'repay', protocolAction: 'repay', vaultOutputIndex: 0 },
  166: { actionFlag: 'd', actionType: 'deposit', protocolAction: 'deposit', vaultOutputIndex: 0 },
  167: { actionFlag: 'w', actionType: 'withdraw', protocolAction: 'withdraw', vaultOutputIndex: 0 },
  168: { actionFlag: 'x', actionType: 'repo', protocolAction: 'repo', vaultOutputIndex: 0 },
  169: { actionFlag: 'l', actionType: 'liquidate', protocolAction: 'trim', vaultOutputIndex: 0 },
};

const DUCAT_ACTION_TYPES: Record<DucatVaultActionFlag, string> = {
  b: 'borrow',
  c: 'close',
  d: 'deposit',
  l: 'liquidate',
  o: 'create',
  r: 'repay',
  w: 'withdraw',
  x: 'repo',
};

type SignerLike = {
  publicKey: Buffer | Uint8Array;
  sign: (hash: Buffer) => Buffer | Uint8Array;
  signSchnorr?: (hash: Buffer) => Buffer | Uint8Array;
};

type PsbtSigner = {
  publicKey: Buffer;
  sign: (hash: Buffer) => Buffer;
  signSchnorr?: (hash: Buffer) => Buffer;
};

export function toSigner(node: SignerLike): PsbtSigner {
  const sign = node.sign.bind(node);
  const signSchnorr = node.signSchnorr?.bind(node);

  return {
    publicKey: Buffer.from(node.publicKey),
    sign: (hash: Buffer) => Buffer.from(sign(hash)),
    signSchnorr: signSchnorr ? (hash: Buffer): Buffer => Buffer.from(signSchnorr(hash)) : undefined,
  };
}

export function taprootSigner(node: DucatKeyNode): PsbtSigner {
  const xOnlyPubkey = Buffer.from(node.publicKey).subarray(1, 33);
  const tweakedNode = node.tweak(crypto.taggedHash('TapTweak', xOnlyPubkey));

  return toSigner(tweakedNode);
}

function assertPsbtInputIndex(psbt: Psbt, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= psbt.data.inputs.length) {
    throw ducatError('PSBT_INPUT_INDEX_INVALID', 'The Ducat app requested a signature for a PSBT input that does not exist.', {
      inputIndex: index,
      inputCount: psbt.data.inputs.length,
    });
  }
}

function sameScript(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function parseP2trOutputKey(outputScript: Buffer): Buffer | null {
  if (outputScript.length !== 34 || outputScript[0] !== opcodes.OP_1 || outputScript[1] !== 0x20) {
    return null;
  }

  return outputScript.subarray(2, 34);
}

function tapLeafContainsPubkey(script: Buffer, xOnlyPubkey: Buffer): boolean {
  const chunks = btcScript.decompile(script);

  return chunks?.some((chunk) => Buffer.isBuffer(chunk) && chunk.equals(xOnlyPubkey)) ?? false;
}

function tapLeafHashForSigning(tapLeaf: { leafVersion: number; script: Uint8Array }): Buffer {
  return tapleafHash({
    output: Buffer.from(tapLeaf.script),
    version: tapLeaf.leafVersion,
  });
}

function tapLeafCommitsToOutputKey(
  tapLeaf: { controlBlock: Uint8Array; leafVersion: number; script: Uint8Array },
  outputKey: Buffer,
): boolean {
  try {
    const controlBlock = Buffer.from(tapLeaf.controlBlock);
    const leafVersion = controlBlock[0] & TAPLEAF_VERSION_MASK;
    const psbtLeafVersion = tapLeaf.leafVersion & TAPLEAF_VERSION_MASK;

    if (psbtLeafVersion !== leafVersion) {
      return false;
    }

    const leafHash = tapleafHash({
      output: Buffer.from(tapLeaf.script),
      version: tapLeaf.leafVersion,
    });
    const merkleRoot = rootHashFromPath(controlBlock, leafHash);
    const internalKey = controlBlock.subarray(1, 33);
    const tweakedKey = tweakKey(internalKey, merkleRoot);

    return (tweakedKey?.x.equals(outputKey) ?? false) && tweakedKey?.parity === (controlBlock[0] & 1);
  } catch {
    return false;
  }
}

type TaprootScriptPathOwnership = {
  ok: boolean;
  reason: string;
  leafHash?: Buffer;
  guardPubkey?: string;
  guardianKnown?: boolean;
  /** Which owned-leaf shape matched: a 2-of-2 cosign leaf or a BitVM3 timeout leaf. */
  leafKind?: 'cosign' | 'bitvm3-timeout';
};

function checkOwnedTaprootScriptPathInput(
  input: Psbt['data']['inputs'][number],
  outputScript: Buffer,
  keySet: AccountPublicSet,
  role: DucatAddressRole,
): TaprootScriptPathOwnership {
  if (role !== 'vault') {
    return { ok: false, reason: 'Taproot script-path signing is restricted to the Ducat vault account' };
  }

  const outputKey = parseP2trOutputKey(outputScript);

  if (!outputKey) {
    return { ok: false, reason: 'prevout is not a P2TR output' };
  }

  if (!input.tapLeafScript?.length) {
    return { ok: false, reason: 'missing tapLeafScript data' };
  }

  const vaultPubkeyHex = keySet.vaultInternalPubkey.toString('hex');

  // BitVM3 unilateral-exit TIMEOUT leaf: `<Δ> OP_CSV OP_DROP <vault_pk> OP_CHECKSIG`.
  // The assert output is NUMS-keyed (no cosign leaf), so this is checked before the
  // cosign-specific path. We sign ONLY when the embedded operator key is the derived
  // vault pubkey AND the leaf is genuinely committed to the spent output key (same
  // anti-abuse rigor as the cosign branch — never sign a leaf the prevout doesn't
  // actually commit to).
  const ownedTimeoutLeaf = input.tapLeafScript.find(
    (tapLeaf) =>
      matchTimeoutLeafHex(Buffer.from(tapLeaf.script).toString('hex'))?.operator === vaultPubkeyHex &&
      tapLeafCommitsToOutputKey(tapLeaf, outputKey),
  );

  if (ownedTimeoutLeaf) {
    return {
      ok: true,
      reason: 'committed BitVM3 timeout leaf',
      leafHash: tapLeafHashForSigning(ownedTimeoutLeaf),
      leafKind: 'bitvm3-timeout',
    };
  }

  const pubkeyLeafIndex = input.tapLeafScript.findIndex((tapLeaf) =>
    tapLeafContainsPubkey(Buffer.from(tapLeaf.script), keySet.vaultInternalPubkey),
  );

  if (pubkeyLeafIndex === -1) {
    return { ok: false, reason: `no tapLeafScript contains the Ducat Snap vault pubkey (${input.tapLeafScript.length} provided)` };
  }

  const cosignLeafIndex = input.tapLeafScript.findIndex((tapLeaf) => matchCosignLeafHex(Buffer.from(tapLeaf.script).toString('hex'))?.client === vaultPubkeyHex);

  if (cosignLeafIndex === -1) {
    return { ok: false, reason: 'no tapLeafScript is a Ducat cosign leaf for the derived vault pubkey' };
  }

  const ownedCommittedLeaf = input.tapLeafScript.find(
    (tapLeaf) => matchCosignLeafHex(Buffer.from(tapLeaf.script).toString('hex'))?.client === vaultPubkeyHex && tapLeafCommitsToOutputKey(tapLeaf, outputKey),
  );

  if (ownedCommittedLeaf) {
    const guardPubkey = matchCosignLeafHex(Buffer.from(ownedCommittedLeaf.script).toString('hex'))?.guard;

    if (guardPubkey && !isKnownGuardianPubkey(keySet.network, guardPubkey)) {
      return {
        ok: false,
        reason: `cosign guard key ${guardPubkey} is not an approved Ducat guardian`,
        guardPubkey,
        guardianKnown: false,
      };
    }

    return {
      ok: true,
      reason: 'committed Ducat cosign leaf',
      leafHash: tapLeafHashForSigning(ownedCommittedLeaf),
      guardPubkey,
      guardianKnown: guardPubkey ? guardianAllowlistEnforced(keySet.network) : undefined,
      leafKind: 'cosign',
    };
  }

  const committedLeafIndex = input.tapLeafScript.findIndex((tapLeaf) => tapLeafCommitsToOutputKey(tapLeaf, outputKey));

  if (committedLeafIndex !== -1) {
    return {
      ok: false,
      reason: `Ducat cosign leaf ${cosignLeafIndex} and committed tapleaf ${committedLeafIndex} are different leaves`,
    };
  }

  return { ok: false, reason: 'no Ducat cosign leaf commits the derived vault pubkey to the prevout output' };
}

/**
 * Reconcile a signed input's witnessUtxo against any nonWitnessUtxo the request also supplied.
 *
 * The Snap validates and displays everything from witnessUtxo, but bitcoinjs-lib computes the
 * segwit sighash from nonWitnessUtxo whenever it is present. If the two disagree, the user would
 * approve one value while signing over a different (real) value. We require them to match exactly,
 * so the value committed by the signature is always the value shown in the confirmation dialog.
 *
 * @param psbt - The parsed PSBT.
 * @param index - The input index being validated.
 * @param witnessUtxo - The input's witnessUtxo (already known to be present).
 */
function assertWitnessUtxoMatchesNonWitnessUtxo(
  psbt: Psbt,
  index: number,
  witnessUtxo: NonNullable<Psbt['data']['inputs'][number]['witnessUtxo']>,
): void {
  const input = psbt.data.inputs[index];

  if (!input.nonWitnessUtxo) {
    return;
  }

  const prevoutIndex = psbt.txInputs[index]?.index;

  if (prevoutIndex === undefined) {
    throw ducatError('PSBT_INPUT_VALUE_MISMATCH', 'This PSBT input references previous-output data the Ducat Snap cannot verify and will not sign.', {
      inputIndex: index,
    });
  }

  let prevout: { value: number; script: Buffer };

  try {
    const prevoutTx = Transaction.fromBuffer(Buffer.from(input.nonWitnessUtxo));
    prevout = prevoutTx.outs[prevoutIndex];
  } catch (error) {
    throw ducatError('PSBT_INPUT_VALUE_MISMATCH', 'This PSBT input includes malformed previous-transaction data and cannot be signed safely.', {
      inputIndex: index,
      diagnostic: error instanceof Error ? error.message : String(error),
    });
  }

  if (!prevout || prevout.value !== witnessUtxo.value || !sameScript(Buffer.from(prevout.script), Buffer.from(witnessUtxo.script))) {
    throw ducatError('PSBT_INPUT_VALUE_MISMATCH', 'This PSBT input value disagrees with its previous transaction and cannot be signed safely.', {
      inputIndex: index,
      witnessUtxoValueSats: witnessUtxo.value,
      nonWitnessUtxoValueSats: prevout?.value,
    });
  }
}

/**
 * Reject any input whose requested sighash type is not one the Snap is willing to produce.
 *
 * The confirmation dialog represents a transaction that commits to all inputs and outputs. A
 * SIGHASH_NONE/SINGLE/ANYONECANPAY input would let other parties alter the transaction after the
 * user approves it, so we refuse such inputs before showing the dialog.
 *
 * @param input - The PSBT input being validated.
 * @param index - The input index.
 * @param role - The Ducat account role signing this input.
 */
function assertAllowedSighashType(input: Psbt['data']['inputs'][number], index: number, role: DucatAddressRole): void {
  if (input.sighashType === undefined) {
    return;
  }

  const allowed = role === 'sats' ? ALLOWED_ECDSA_SIGHASH_TYPES : ALLOWED_TAPROOT_SIGHASH_TYPES;

  if (!allowed.includes(input.sighashType)) {
    throw ducatError('PSBT_SIGHASH_NOT_ALLOWED', 'This PSBT input requests a signature type the Ducat Snap will not produce.', {
      inputIndex: index,
      requestedSighashType: input.sighashType,
    });
  }
}

function validateSignedInput(psbt: Psbt, index: number, address: string, keySet: AccountPublicSet): PsbtInputSummary {
  const role = getRoleForAddress(keySet, address);

  if (!role) {
    throw ducatError('UNMANAGED_ADDRESS', 'This address is not managed by the Ducat Snap.', { address });
  }

  const input = psbt.data.inputs[index];
  const witnessUtxo = input.witnessUtxo;

  if (!witnessUtxo) {
    throw ducatError('MISSING_WITNESS_UTXO', 'This PSBT is missing required input value data and cannot be signed safely.', { inputIndex: index });
  }

  assertWitnessUtxoMatchesNonWitnessUtxo(psbt, index, witnessUtxo);
  assertAllowedSighashType(input, index, role);

  const expectedScript = getOutputScriptForRole(keySet, role);
  const inputScript = Buffer.from(witnessUtxo.script);
  const actualAddress = parseOutputAddress(inputScript, keySet.network);

  if (!sameScript(inputScript, expectedScript)) {
    const scriptPathOwnership = role !== 'sats' ? checkOwnedTaprootScriptPathInput(input, inputScript, keySet, role) : null;

    if (scriptPathOwnership?.ok) {
      return {
        index,
        address: actualAddress,
        signingAddress: address,
        role,
        valueSats: witnessUtxo.value,
        verification:
          scriptPathOwnership.leafKind === 'bitvm3-timeout' ? 'committed-bitvm3-timeout-leaf' : 'committed-ducat-cosign-leaf',
        cosignGuardPubkey: scriptPathOwnership.guardPubkey,
        cosignGuardianKnown: scriptPathOwnership.guardianKnown,
      };
    }

    throw ducatError('PSBT_INPUT_ACCOUNT_MISMATCH', 'This transaction is trying to spend an input from a different Ducat Snap account.', {
      inputIndex: index,
      requestedAddress: address,
      expectedRole: role,
      actualAddress,
      taprootScriptPathCheck: scriptPathOwnership?.reason,
    });
  }

  return {
    index,
    address: actualAddress,
    signingAddress: address,
    role,
    valueSats: witnessUtxo.value,
    verification: 'matched-account-output',
  };
}

function outpointKey(input: Psbt['txInputs'][number]): string {
  return `${Buffer.from(input.hash).toString('hex')}:${input.index}`;
}

function assertUniqueInputOutpoints(psbt: Psbt): void {
  const seen = new Map<string, number>();

  for (const [index, input] of psbt.txInputs.entries()) {
    const key = outpointKey(input);
    const previousIndex = seen.get(key);

    if (previousIndex !== undefined) {
      throw ducatError('PSBT_DUPLICATE_INPUT', 'This PSBT includes the same previous output more than once and cannot be signed safely.', {
        inputIndex: index,
        duplicateOf: previousIndex,
      });
    }

    seen.set(key, index);
  }
}

// Mirrors confirmations.ts isDataOutput: OP_RETURN and zero-value unknown scripts are data,
// not spendable recipients, and are excluded from the itemized recipient list.
function isSummaryDataOutput(output: PsbtOutputSummary): boolean {
  return output.role === 'op_return' || (output.role === 'unknown' && output.valueSats === 0);
}

/**
 * Reject a PSBT where an external recipient would fall outside the dialog's visible output fold.
 *
 * The confirmation itemizes the first VISIBLE_OUTPUT_FOLD *non-data* outputs in transaction order
 * (change + external interleaved), then collapses the rest into a hidden aggregate. Counting only
 * external outputs is not enough (SAY-07 follow-up): change outputs ordered before a recipient
 * still consume visible slots, so a PSBT with several leading change outputs and a couple of later
 * recipients can push a recipient address past the fold even with few external outputs total. We
 * reject when any external output's position *among non-data outputs* is at or beyond the fold, so
 * the cap matches exactly what the user can see.
 */
function assertAllExternalRecipientsVisible(summary: PsbtSummary): void {
  let nonDataPosition = 0;

  for (const output of summary.outputs) {
    if (isSummaryDataOutput(output)) {
      continue;
    }

    if (!output.isMine && nonDataPosition >= VISIBLE_OUTPUT_FOLD) {
      throw ducatError('PSBT_TOO_MANY_RECIPIENTS', 'This PSBT has an external recipient the Ducat confirmation cannot individually display (it falls past the visible output list), so it was rejected rather than hiding the destination.', {
        hiddenRecipientAddress: output.address,
        visibleOutputFold: VISIBLE_OUTPUT_FOLD,
      });
    }

    nonDataPosition += 1;
  }
}

/**
 * Reject a batch where two entries spend the same outpoint. assertUniqueInputOutpoints
 * only deduplicates within a single PSBT, but the batch dialog promises "all-or-nothing"
 * and "signs the full batch in order" — a promise that cannot hold if entries conflict,
 * since two transactions spending the same UTXO can never both confirm (SAY-04).
 */
export function assertUniqueBatchOutpoints(psbts: Psbt[]): void {
  const seen = new Map<string, number>();

  for (const [entryIndex, psbt] of psbts.entries()) {
    for (const input of psbt.txInputs) {
      const key = outpointKey(input);
      const previousEntry = seen.get(key);

      if (previousEntry !== undefined && previousEntry !== entryIndex) {
        throw ducatError('BATCH_CONFLICTING_OUTPOINT', 'Two transactions in this batch spend the same previous output, so they cannot all be confirmed. The batch was rejected.', {
          entryIndex,
          conflictsWithEntry: previousEntry,
          outpoint: key,
        });
      }

      seen.set(key, entryIndex);
    }
  }
}

function parseOutputAddress(outputScript: Buffer, network: DucatNetwork): string {
  try {
    return btcAddress.fromOutputScript(outputScript, bitcoinNetwork(network));
  } catch {
    const chunks = btcScript.decompile(outputScript);
    if (chunks?.[0] === opcodes.OP_RETURN) {
      const payload = chunks.slice(1).map((chunk) => {
        if (Buffer.isBuffer(chunk)) {
          return chunk.toString('hex');
        }

        if (chunk === opcodes.OP_8) {
          return 'OP_8';
        }

        return `OP_${chunk}`;
      });

      return payload.length ? `OP_RETURN ${payload.join(' ')}` : 'OP_RETURN';
    }

    return 'Unknown script';
  }
}

function isOpReturnScript(outputScript: Buffer): boolean {
  const chunks = btcScript.decompile(outputScript);

  return chunks?.[0] === opcodes.OP_RETURN;
}

function readUint32(payload: Buffer, offset: number): number {
  return payload.readUInt32BE(offset);
}

function actionFlag(value: number): DucatVaultActionFlag | null {
  const flag = String.fromCharCode(value) as DucatVaultActionFlag;

  return flag in DUCAT_ACTION_TYPES ? flag : null;
}

type DecodedVaultAction = {
  actionFlag: DucatVaultActionFlag;
  actionType: string;
  protocolAction?: string;
  sequenceCode?: number;
  sequenceVersion?: number;
  vaultOutputIndex: number;
};

function decodeVaultActionFromSequences(inputs: Psbt['txInputs']): DecodedVaultAction | null {
  for (const input of inputs) {
    if (input.sequence === undefined) {
      continue;
    }

    const sequence = input.sequence >>> 0;
    const isMetadata = (sequence & SEQUENCE_TIMELOCK_DISABLE) !== 0 && (sequence & SEQUENCE_METADATA_SIGNAL) !== 0 && (sequence & SEQUENCE_METADATA_DISABLE) === 0;

    if (!isMetadata) {
      continue;
    }

    const version = sequence & SEQUENCE_METADATA_BYTE_MASK;
    const code = (sequence >>> 8) & SEQUENCE_METADATA_SHORT_MASK;
    const action = DUCAT_VAULT_ACTION_CODES[code];

    if (version === DUCAT_VAULT_SEQUENCE_VERSION && action) {
      return {
        ...action,
        sequenceCode: code,
        sequenceVersion: version,
      };
    }
  }

  return null;
}

function inferVaultCollateralSats(
  action: DecodedVaultAction,
  outputs: Psbt['txOutputs'],
  network: DucatNetwork,
  keySet: AccountPublicSet,
): number | undefined {
  const outputIndex = action.vaultOutputIndex;
  const output = outputs[outputIndex];

  if (!output || output.value <= 0 || isOpReturnScript(Buffer.from(output.script))) {
    return undefined;
  }

  // Only treat this output as collateral when it actually pays the user's own
  // vault address. The frontend chooses vaultOutputIndex positionally, so without
  // this check it could place an attacker-bound amount at that index and have it
  // displayed as authoritative "Collateral" under the "decoded from vault data"
  // badge (SAY-01). A non-vault output here yields no collateral figure.
  const address = output.address ?? parseOutputAddress(Buffer.from(output.script), network);

  if (outputRole(address, keySet) !== 'vault') {
    return undefined;
  }

  return output.value;
}

// Index into a tx's outputs that carries the vault for a given legacy action flag.
// Mirrors DUCAT_VAULT_ACTION_CODES so a legacy-decoded action does not diverge from
// the canonical sequence decode (SAY-01): e.g. borrow ('b') is output 1, not 0.
const LEGACY_VAULT_OUTPUT_INDEX: Record<DucatVaultActionFlag, number> = {
  o: 2,
  c: -1,
  b: 1,
  r: 0,
  d: 0,
  w: 0,
  x: 0,
  l: 0,
};

function legacyVaultAction(flag: DucatVaultActionFlag): DecodedVaultAction {
  return {
    actionFlag: flag,
    actionType: DUCAT_ACTION_TYPES[flag],
    protocolAction: DUCAT_ACTION_TYPES[flag],
    vaultOutputIndex: LEGACY_VAULT_OUTPUT_INDEX[flag] ?? 0,
  };
}

function decodeLegacyDucatVaultReturn(
  payload: Buffer,
  action: DecodedVaultAction,
  outputIndex: number,
  outputs: Psbt['txOutputs'],
  network: DucatNetwork,
  keySet: AccountPublicSet,
): DucatVaultReturnData | null {
  if (payload.length !== DUCAT_VAULT_RETURN_MIN_SIZE && payload.length !== DUCAT_VAULT_RETURN_LOCKED_SIZE) {
    return null;
  }

  const version = payload[0];
  const payloadAction = actionFlag(payload[1]);

  if (version !== DUCAT_VAULT_RETURN_VERSION || !payloadAction || payloadAction !== action.actionFlag) {
    return null;
  }

  const unitBalanceCents = readUint32(payload, 2);
  const unitPrice = readUint32(payload, 6);
  const unitTimestamp = readUint32(payload, 10);
  const isLocked = unitBalanceCents > 0;

  if ((isLocked && payload.length !== DUCAT_VAULT_RETURN_LOCKED_SIZE) || (!isLocked && payload.length !== DUCAT_VAULT_RETURN_MIN_SIZE)) {
    return null;
  }

  const decoded: DucatVaultReturnData = {
    actionFlag: action.actionFlag,
    actionType: action.actionType,
    protocolAction: action.protocolAction,
    sequenceCode: action.sequenceCode,
    sequenceVersion: action.sequenceVersion,
    outputIndex,
    isLocked,
    unitBalanceCents,
    unitBalanceUnit: unitBalanceCents / 100,
    unitPrice,
    unitTimestamp,
    collateralSats: inferVaultCollateralSats(action, outputs, network, keySet),
  };

  if (isLocked) {
    decoded.tholdPrice = readUint32(payload, 14);
    decoded.tholdHash = payload.subarray(18, 38).toString('hex');
  }

  return decoded;
}

function decodeCoreDucatVaultReturn(
  payload: Buffer,
  action: DecodedVaultAction,
  outputIndex: number,
  outputs: Psbt['txOutputs'],
  network: DucatNetwork,
  keySet: AccountPublicSet,
): DucatVaultReturnData | null {
  if (payload.length < 2 || payload[0] !== DUCAT_VAULT_RETURN_VERSION) {
    return null;
  }

  const guardianCount = payload[1];

  if (guardianCount < 1 || guardianCount > DUCAT_MAX_GUARD_COUNT || payload.length < 2 + guardianCount) {
    return null;
  }

  const baseOffset = 2 + guardianCount;

  if (payload.length === baseOffset) {
    return {
      actionFlag: action.actionFlag,
      actionType: action.actionType,
      protocolAction: action.protocolAction,
      sequenceCode: action.sequenceCode,
      sequenceVersion: action.sequenceVersion,
      outputIndex,
      isLocked: false,
      unitBalanceCents: 0,
      unitBalanceUnit: 0,
      unitPrice: 0,
      unitTimestamp: 0,
      collateralSats: inferVaultCollateralSats(action, outputs, network, keySet),
      guardianCount,
      priceCommitCount: 0,
    };
  }

  if (payload.length < baseOffset + 9) {
    return null;
  }

  const unitBalanceCents = readUint32(payload, baseOffset);
  const unitTimestamp = readUint32(payload, baseOffset + 4);
  const priceCommitCount = payload[baseOffset + 8];
  const commitsOffset = baseOffset + 9;

  if (priceCommitCount < 1 || priceCommitCount > DUCAT_MAX_ORACLE_COUNT || payload.length !== commitsOffset + priceCommitCount * DUCAT_PRICE_COMMIT_SIZE) {
    return null;
  }

  let baseCommitOffset = commitsOffset;
  let lowestUnitPrice = Number.POSITIVE_INFINITY;

  for (let index = 0; index < priceCommitCount; index++) {
    const commitOffset = commitsOffset + index * DUCAT_PRICE_COMMIT_SIZE;
    const commitUnitPrice = readUint32(payload, commitOffset + 1);

    if (commitUnitPrice < lowestUnitPrice) {
      lowestUnitPrice = commitUnitPrice;
      baseCommitOffset = commitOffset;
    }
  }

  const unitPrice = readUint32(payload, baseCommitOffset + 1);
  const tholdPrice = readUint32(payload, baseCommitOffset + 5);
  const tholdHash = payload.subarray(baseCommitOffset + 9, baseCommitOffset + 29).toString('hex');

  return {
    actionFlag: action.actionFlag,
    actionType: action.actionType,
    protocolAction: action.protocolAction,
    sequenceCode: action.sequenceCode,
    sequenceVersion: action.sequenceVersion,
    outputIndex,
    isLocked: unitBalanceCents > 0,
    unitBalanceCents,
    unitBalanceUnit: unitBalanceCents / 100,
    unitPrice,
    unitTimestamp,
    collateralSats: inferVaultCollateralSats(action, outputs, network, keySet),
    tholdPrice,
    tholdHash,
    guardianCount,
    priceCommitCount,
  };
}

function decodeDucatVaultReturn(
  outputScript: Buffer,
  outputIndex: number,
  psbt: Psbt,
  network: DucatNetwork,
  keySet: AccountPublicSet,
): DucatVaultReturnData | null {
  const chunks = btcScript.decompile(outputScript);

  if (chunks?.length !== 3 || chunks[0] !== opcodes.OP_RETURN || chunks[1] !== opcodes.OP_8 || !Buffer.isBuffer(chunks[2])) {
    return null;
  }

  const payload = chunks[2];
  const sequenceAction = decodeVaultActionFromSequences(psbt.txInputs);

  if (sequenceAction) {
    return (
      decodeCoreDucatVaultReturn(payload, sequenceAction, outputIndex, psbt.txOutputs, network, keySet) ??
      decodeLegacyDucatVaultReturn(payload, sequenceAction, outputIndex, psbt.txOutputs, network, keySet)
    );
  }

  const payloadAction = actionFlag(payload[1]);

  return payloadAction
    ? decodeLegacyDucatVaultReturn(payload, legacyVaultAction(payloadAction), outputIndex, psbt.txOutputs, network, keySet)
    : null;
}

function allSignedInputIndexes(signInputs: SignInputs): number[] {
  return Object.values(signInputs)
    .flat()
    .filter((index, offset, indexes) => indexes.indexOf(index) === offset)
    .sort((a, b) => a - b);
}

export function parsePsbt(psbtBase64: string, network: DucatNetwork): Psbt {
  if (psbtBase64.length > MAX_PSBT_BASE64_LENGTH) {
    throw ducatError('PSBT_TOO_LARGE', 'This PSBT is too large for the Ducat Snap to display and sign safely.', {
      maxBase64Length: MAX_PSBT_BASE64_LENGTH,
      actualBase64Length: psbtBase64.length,
    });
  }

  try {
    return Psbt.fromBase64(psbtBase64, { network: bitcoinNetwork(network) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/duplicate input detected/iu.test(message)) {
      throw ducatError('PSBT_DUPLICATE_INPUT', 'This PSBT includes the same previous output more than once and cannot be signed safely.', {
        diagnostic: message,
      });
    }

    throw ducatError('MALFORMED_PSBT', 'The Ducat app sent a malformed PSBT.', { diagnostic: message });
  }
}

function outputRole(address: string, keySet: AccountPublicSet): PsbtOutputSummary['role'] {
  if (address.startsWith('OP_RETURN')) {
    return 'op_return';
  }

  if (address === 'Unknown script') {
    return 'unknown';
  }

  if (address === keySet.record.sats.address) {
    return 'sats';
  }

  if (address === keySet.record.runes.address) {
    return 'runes';
  }

  if (address === keySet.record.vault.address) {
    return 'vault';
  }

  return 'external';
}

function buildWarnings(feeSats: number | null, outputs: PsbtOutputSummary[]): string[] {
  const warnings: string[] = [];

  if (feeSats === null) {
    warnings.push('Fee is unavailable because one or more PSBT inputs omitted value data.');
  }

  if (outputs.some((output) => output.address.startsWith('OP_RETURN') && output.address.includes('OP_8') && !output.vaultData)) {
    warnings.push('A Ducat-looking OP_RETURN output was present but could not be decoded as vault return data.');
  }

  if (outputs.some((output) => output.role === 'op_return' && output.valueSats > 0)) {
    warnings.push('An OP_RETURN data output carries BTC value. Those sats are provably unspendable.');
  }

  if (outputs.some((output) => output.role === 'unknown' && output.valueSats === 0)) {
    warnings.push('A zero-value unknown-script output is present. Review the script data before signing.');
  }

  return warnings;
}

export function summarizePsbt(
  psbt: Psbt,
  network: DucatNetwork,
  keySet: AccountPublicSet,
  signInputs: SignInputs,
  signedInputs: PsbtInputSummary[],
): PsbtSummary {
  const inputValueSats = psbt.data.inputs.reduce<number | null>((total, input) => {
    if (total === null || !input.witnessUtxo) {
      return null;
    }

    return total + input.witnessUtxo.value;
  }, 0);
  const outputs: PsbtOutputSummary[] = psbt.txOutputs.map((output, index) => {
    const outputScript = Buffer.from(output.script);
    const outputAddress = output.address ?? parseOutputAddress(outputScript, network);
    const role = outputRole(outputAddress, keySet);
    const vaultData = decodeDucatVaultReturn(outputScript, index, psbt, network, keySet) ?? undefined;

    return {
      address: outputAddress,
      valueSats: output.value,
      isMine: role === 'sats' || role === 'runes' || role === 'vault',
      role,
      vaultData,
    };
  });
  const vaultUpdates = outputs.map((output) => output.vaultData).filter((vaultData): vaultData is DucatVaultReturnData => !!vaultData);
  const outputValueSats = outputs.reduce((total, output) => total + output.valueSats, 0);
  const feeSats = inputValueSats === null ? null : inputValueSats - outputValueSats;

  if (feeSats !== null && feeSats < 0) {
    throw ducatError('PSBT_FEE_INVALID', 'This PSBT spends more than its inputs provide and cannot be signed safely.', {
      inputValueSats,
      outputValueSats,
      feeSats,
    });
  }

  return {
    network,
    inputCount: psbt.data.inputs.length,
    signedInputIndexes: allSignedInputIndexes(signInputs),
    signedInputs,
    outputCount: outputs.length,
    outputs,
    feeSats,
    inputValueSats,
    signedInputValueSats: signedInputs.every((input) => input.valueSats !== null)
      ? signedInputs.reduce((total, input) => total + (input.valueSats ?? 0), 0)
      : null,
    outputValueSats,
    externalOutputSats: outputs.filter((output) => !output.isMine).reduce((total, output) => total + output.valueSats, 0),
    selfOutputSats: outputs.filter((output) => output.isMine).reduce((total, output) => total + output.valueSats, 0),
    vaultUpdates,
    warnings: buildWarnings(feeSats, outputs),
  };
}

export function preparePsbtForSigning(psbtBase64: string, network: DucatNetwork, keySet: AccountPublicSet, signInputs: SignInputs): {
  psbt: Psbt;
  summary: PsbtSummary;
} {
  const psbt = parsePsbt(psbtBase64, network);
  const signedInputs: PsbtInputSummary[] = [];

  if (psbt.data.inputs.length > MAX_PSBT_INPUTS || psbt.txOutputs.length > MAX_PSBT_OUTPUTS) {
    throw ducatError('PSBT_TOO_LARGE', 'This PSBT has too many inputs or outputs for the Ducat Snap to display and sign safely.', {
      inputCount: psbt.data.inputs.length,
      outputCount: psbt.txOutputs.length,
      maxInputs: MAX_PSBT_INPUTS,
      maxOutputs: MAX_PSBT_OUTPUTS,
    });
  }

  assertUniqueInputOutpoints(psbt);

  for (const [inputAddress, indexes] of Object.entries(signInputs)) {
    if (!Array.isArray(indexes) || indexes.length === 0) {
      throw ducatError('INVALID_PARAMS', 'The Ducat app did not specify which inputs should be signed.', { address: inputAddress });
    }

    for (const index of indexes) {
      assertPsbtInputIndex(psbt, index);
      signedInputs.push(validateSignedInput(psbt, index, inputAddress, keySet));
    }
  }

  const summary = summarizePsbt(psbt, network, keySet, signInputs, signedInputs);

  assertAllExternalRecipientsVisible(summary);

  return {
    psbt,
    summary,
  };
}

export function signPreparedPsbt(psbt: Psbt, keySet: AccountKeySet, signInputs: SignInputs): string {
  for (const [inputAddress, indexes] of Object.entries(signInputs)) {
    const role = getRoleForAddress(keySet, inputAddress);

    if (!role) {
      throw ducatError('UNMANAGED_ADDRESS', 'This address is not managed by the Ducat Snap.', { address: inputAddress });
    }

    for (const index of indexes) {
      const node = getNodeForRole(keySet, role);

      if (role === 'sats') {
        psbt.signInput(index, toSigner(node), ALLOWED_ECDSA_SIGHASH_TYPES);
      } else {
        const input = psbt.data.inputs[index];
        const inputScript = input.witnessUtxo ? Buffer.from(input.witnessUtxo.script) : null;
        const expectedScript = getOutputScriptForRole(keySet, role);
        const isKeyPathSpend = !!inputScript && sameScript(inputScript, expectedScript);

        if (isKeyPathSpend) {
          const currentTapInternalKey = input.tapInternalKey;
          const expectedInternalPubkey = role === 'runes' ? keySet.runesInternalPubkey : keySet.vaultInternalPubkey;

          if (currentTapInternalKey && !Buffer.from(currentTapInternalKey).equals(expectedInternalPubkey)) {
            throw ducatError('PSBT_INPUT_ACCOUNT_MISMATCH', 'This Taproot input does not match the Ducat Snap account.', {
              inputIndex: index,
            });
          }

          if (!currentTapInternalKey) {
            psbt.updateInput(index, { tapInternalKey: expectedInternalPubkey });
          }

          psbt.signTaprootInput(index, taprootSigner(node), undefined, ALLOWED_TAPROOT_SIGHASH_TYPES);
        } else {
          if (!inputScript) {
            throw ducatError('MISSING_WITNESS_UTXO', 'This PSBT is missing required input value data and cannot be signed safely.', { inputIndex: index });
          }

          const scriptPathOwnership = checkOwnedTaprootScriptPathInput(input, inputScript, keySet, role);

          if (!scriptPathOwnership.ok || !scriptPathOwnership.leafHash) {
            throw ducatError('PSBT_INPUT_ACCOUNT_MISMATCH', 'This Taproot script-path input does not match the Ducat vault cosign policy.', {
              inputIndex: index,
              taprootScriptPathCheck: scriptPathOwnership.reason,
            });
          }

          psbt.signTaprootInput(index, toSigner(keySet.vaultNode), scriptPathOwnership.leafHash, ALLOWED_TAPROOT_SIGHASH_TYPES);
        }
      }
    }
  }

  return psbt.toBase64();
}
