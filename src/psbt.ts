import { address as btcAddress, crypto, opcodes, Psbt, script as btcScript } from 'bitcoinjs-lib';
import { rootHashFromPath, tapleafHash, tweakKey } from 'bitcoinjs-lib/src/payments/bip341';
import { Buffer } from 'buffer';

import { type AccountKeySet, getRoleForAddress } from './accounts';
import type { DucatKeyNode } from './bip32';
import { ducatError } from './errors';
import { bitcoinNetwork } from './networks';
import type {
  DucatNetwork,
  PsbtInputSummary,
  PsbtInputVerification,
  PsbtOutputSummary,
  PsbtSummary,
  SignInputs,
} from './types';

const TAPLEAF_VERSION_MASK = 0xfe;
const MAX_PSBT_BASE64_LENGTH = 350_000;
const MAX_PSBT_INPUTS = 80;
const MAX_PSBT_OUTPUTS = 120;

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

  // Current Ducat alpha deposit PSBTs can include a vault tapleaf that contains
  // the derived key but cannot be recomputed against the prevout output. The
  // signature still commits to the supplied prevout and requires confirmation.
  return { ok: true, reason: 'owned unverified Ducat alpha Taproot script-path input' };
}

function verificationFromScriptPath(reason: string): PsbtInputVerification {
  return reason.includes('unverified') ? 'alpha-unverified-taproot-script-path' : 'committed-taproot-script-path';
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
        verification: verificationFromScriptPath(scriptPathOwnership.reason),
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
      const payload = chunks.slice(1).filter(Buffer.isBuffer).map((chunk) => chunk.toString('hex'));

      return payload.length ? `OP_RETURN ${payload.join(' ')}` : 'OP_RETURN';
    }

    return 'Unknown script';
  }
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

function buildWarnings(signedInputs: PsbtInputSummary[], feeSats: number | null): string[] {
  const warnings: string[] = [];

  if (feeSats === null) {
    warnings.push('Fee is unavailable because one or more PSBT inputs omitted value data.');
  }

  if (signedInputs.some((input) => input.verification === 'alpha-unverified-taproot-script-path')) {
    warnings.push('Alpha compatibility path: one Taproot script-path input contains the Ducat vault key but could not be fully recomputed against the prevout.');
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
  const outputs: PsbtOutputSummary[] = psbt.txOutputs.map((output) => {
    const outputAddress = output.address ?? parseOutputAddress(Buffer.from(output.script), network);
    const role = outputRole(outputAddress, keySet);

    return {
      address: outputAddress,
      valueSats: output.value,
      isMine: role === 'sats' || role === 'runes' || role === 'vault',
      role,
    };
  });
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
    warnings: buildWarnings(signedInputs, feeSats),
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
