import { address as btcAddress, crypto, opcodes, Psbt, script as btcScript } from 'bitcoinjs-lib';
import { rootHashFromPath, tapleafHash, tweakKey } from 'bitcoinjs-lib/src/payments/bip341';
import { Buffer } from 'buffer';

import { type AccountKeySet, getRoleForAddress } from './accounts';
import type { DucatKeyNode } from './bip32';
import { ducatError } from './errors';
import { bitcoinNetwork } from './networks';
import type {
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
const MAX_PSBT_INPUTS = 80;
const MAX_PSBT_OUTPUTS = 120;
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
    signSchnorr: signSchnorr ? (hash: Buffer) => Buffer.from(signSchnorr(hash)) : undefined,
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

function tapLeafCommitsToOutputKey(
  tapLeaf: { controlBlock: Uint8Array; leafVersion: number; script: Uint8Array },
  outputKey: Buffer,
): boolean {
  try {
    const controlBlock = Buffer.from(tapLeaf.controlBlock);
    const leafVersion = controlBlock[0] & TAPLEAF_VERSION_MASK;
    const leafHash = tapleafHash({
      output: Buffer.from(tapLeaf.script),
      version: leafVersion,
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
};

function checkOwnedTaprootScriptPathInput(
  input: Psbt['data']['inputs'][number],
  outputScript: Buffer,
  keySet: AccountKeySet,
): TaprootScriptPathOwnership {
  const outputKey = parseP2trOutputKey(outputScript);

  if (!outputKey) {
    return { ok: false, reason: 'prevout is not a P2TR output' };
  }

  if (!input.tapLeafScript?.length) {
    return { ok: false, reason: 'missing tapLeafScript data' };
  }

  const pubkeyLeafIndex = input.tapLeafScript.findIndex((tapLeaf) =>
    tapLeafContainsPubkey(Buffer.from(tapLeaf.script), keySet.taprootInternalPubkey),
  );

  if (pubkeyLeafIndex === -1) {
    return { ok: false, reason: `no tapLeafScript contains the Ducat Snap vault pubkey (${input.tapLeafScript.length} provided)` };
  }

  const ownedCommittedLeafIndex = input.tapLeafScript.findIndex(
    (tapLeaf) =>
      tapLeafContainsPubkey(Buffer.from(tapLeaf.script), keySet.taprootInternalPubkey) && tapLeafCommitsToOutputKey(tapLeaf, outputKey),
  );

  if (ownedCommittedLeafIndex !== -1) {
    return { ok: true, reason: 'owned committed Taproot script-path input' };
  }

  const committedLeafIndex = input.tapLeafScript.findIndex((tapLeaf) => tapLeafCommitsToOutputKey(tapLeaf, outputKey));

  if (committedLeafIndex !== -1) {
    return {
      ok: false,
      reason: `vault pubkey tapleaf ${pubkeyLeafIndex} and committed tapleaf ${committedLeafIndex} are different leaves`,
    };
  }

  return { ok: false, reason: 'no tapleaf commits the Ducat Snap vault pubkey to the prevout output' };
}

function validateSignedInput(psbt: Psbt, index: number, address: string, keySet: AccountKeySet): PsbtInputSummary {
  const role = getRoleForAddress(keySet, address);

  if (!role) {
    throw ducatError('UNMANAGED_ADDRESS', 'This address is not managed by the Ducat Snap.', { address });
  }

  const input = psbt.data.inputs[index];
  const witnessUtxo = input.witnessUtxo;

  if (!witnessUtxo) {
    throw ducatError('MISSING_WITNESS_UTXO', 'This PSBT is missing required input value data and cannot be signed safely.', { inputIndex: index });
  }

  const expectedScript = role === 'sats' ? keySet.satsOutputScript : keySet.taprootOutputScript;
  const inputScript = Buffer.from(witnessUtxo.script);
  const actualAddress = parseOutputAddress(inputScript, keySet.network);

  if (!sameScript(inputScript, expectedScript)) {
    const scriptPathOwnership = role !== 'sats' ? checkOwnedTaprootScriptPathInput(input, inputScript, keySet) : null;

    if (scriptPathOwnership?.ok) {
      return {
        index,
        address: actualAddress,
        signingAddress: address,
        role,
        valueSats: witnessUtxo.value,
        verification: 'committed-taproot-script-path',
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

function inferVaultCollateralSats(action: DecodedVaultAction, outputs: Psbt['txOutputs']): number | undefined {
  const outputIndex = action.vaultOutputIndex;
  const output = outputs[outputIndex];

  if (!output || output.value <= 0 || isOpReturnScript(Buffer.from(output.script))) {
    return undefined;
  }

  return output.value;
}

function legacyVaultAction(flag: DucatVaultActionFlag): DecodedVaultAction {
  return {
    actionFlag: flag,
    actionType: DUCAT_ACTION_TYPES[flag],
    protocolAction: DUCAT_ACTION_TYPES[flag],
    vaultOutputIndex: flag === 'o' ? 2 : 0,
  };
}

function decodeLegacyDucatVaultReturn(payload: Buffer, action: DecodedVaultAction, outputIndex: number, outputs: Psbt['txOutputs']): DucatVaultReturnData | null {
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
    collateralSats: inferVaultCollateralSats(action, outputs),
  };

  if (isLocked) {
    decoded.tholdPrice = readUint32(payload, 14);
    decoded.tholdHash = payload.subarray(18, 38).toString('hex');
  }

  return decoded;
}

function decodeCoreDucatVaultReturn(payload: Buffer, action: DecodedVaultAction, outputIndex: number, outputs: Psbt['txOutputs']): DucatVaultReturnData | null {
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
      collateralSats: inferVaultCollateralSats(action, outputs),
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
    collateralSats: inferVaultCollateralSats(action, outputs),
    tholdPrice,
    tholdHash,
    guardianCount,
    priceCommitCount,
  };
}

function decodeDucatVaultReturn(outputScript: Buffer, outputIndex: number, psbt: Psbt): DucatVaultReturnData | null {
  const chunks = btcScript.decompile(outputScript);

  if (chunks?.length !== 3 || chunks[0] !== opcodes.OP_RETURN || chunks[1] !== opcodes.OP_8 || !Buffer.isBuffer(chunks[2])) {
    return null;
  }

  const payload = chunks[2];
  const sequenceAction = decodeVaultActionFromSequences(psbt.txInputs);

  if (sequenceAction) {
    return decodeCoreDucatVaultReturn(payload, sequenceAction, outputIndex, psbt.txOutputs) ?? decodeLegacyDucatVaultReturn(payload, sequenceAction, outputIndex, psbt.txOutputs);
  }

  const payloadAction = actionFlag(payload[1]);

  return payloadAction ? decodeLegacyDucatVaultReturn(payload, legacyVaultAction(payloadAction), outputIndex, psbt.txOutputs) : null;
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

    throw ducatError('MALFORMED_PSBT', 'The Ducat app sent a malformed PSBT.', { diagnostic: message });
  }
}

function outputRole(address: string, keySet: AccountKeySet): PsbtOutputSummary['role'] {
  if (address.startsWith('OP_RETURN')) {
    return 'op_return';
  }

  if (address === 'Unknown script') {
    return 'unknown';
  }

  if (address === keySet.record.sats.address) {
    return 'sats';
  }

  if (address === keySet.record.runes.address || address === keySet.record.vault.address) {
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

  return warnings;
}

export function summarizePsbt(
  psbt: Psbt,
  network: DucatNetwork,
  keySet: AccountKeySet,
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
    const vaultData = decodeDucatVaultReturn(outputScript, index, psbt) ?? undefined;

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

export function preparePsbtForSigning(psbtBase64: string, network: DucatNetwork, keySet: AccountKeySet, signInputs: SignInputs): {
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

  for (const [inputAddress, indexes] of Object.entries(signInputs)) {
    if (!Array.isArray(indexes) || indexes.length === 0) {
      throw ducatError('INVALID_PARAMS', 'The Ducat app did not specify which inputs should be signed.', { address: inputAddress });
    }

    for (const index of indexes) {
      assertPsbtInputIndex(psbt, index);
      signedInputs.push(validateSignedInput(psbt, index, inputAddress, keySet));
    }
  }

  return {
    psbt,
    summary: summarizePsbt(psbt, network, keySet, signInputs, signedInputs),
  };
}

export function signPreparedPsbt(psbt: Psbt, keySet: AccountKeySet, signInputs: SignInputs): string {
  for (const [inputAddress, indexes] of Object.entries(signInputs)) {
    const role = getRoleForAddress(keySet, inputAddress);

    if (!role) {
      throw ducatError('UNMANAGED_ADDRESS', 'This address is not managed by the Ducat Snap.', { address: inputAddress });
    }

    for (const index of indexes) {
      if (role === 'sats') {
        psbt.signInput(index, toSigner(keySet.satsNode));
      } else {
        const input = psbt.data.inputs[index];
        const inputScript = input.witnessUtxo ? Buffer.from(input.witnessUtxo.script) : null;
        const isKeyPathSpend = !!inputScript && sameScript(inputScript, keySet.taprootOutputScript);

        if (isKeyPathSpend) {
          const currentTapInternalKey = input.tapInternalKey;

          if (currentTapInternalKey && !Buffer.from(currentTapInternalKey).equals(keySet.taprootInternalPubkey)) {
            throw ducatError('PSBT_INPUT_ACCOUNT_MISMATCH', 'This Taproot input does not match the Ducat Snap account.', {
              inputIndex: index,
            });
          }

          if (!currentTapInternalKey) {
            psbt.updateInput(index, { tapInternalKey: keySet.taprootInternalPubkey });
          }

          psbt.signTaprootInput(index, taprootSigner(keySet.taprootNode));
        } else {
          psbt.signTaprootInput(index, toSigner(keySet.taprootNode));
        }
      }
    }
  }

  return psbt.toBase64();
}
