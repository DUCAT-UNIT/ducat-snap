import { address as btcAddress, crypto, opcodes, Psbt, script as btcScript } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { type AccountKeySet, getRoleForAddress } from './accounts';
import type { DucatKeyNode } from './bip32';
import { bitcoinNetwork } from './networks';
import type { DucatNetwork, PsbtOutputSummary, PsbtSummary, SignInputs } from './types';

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
    throw new Error(`Invalid PSBT input index ${index}.`);
  }
}

function sameScript(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function assertInputMatchesAddress(psbt: Psbt, index: number, address: string, keySet: AccountKeySet): void {
  const role = getRoleForAddress(keySet, address);

  if (!role) {
    throw new Error(`Address ${address} is not managed by the Ducat Snap.`);
  }

  const input = psbt.data.inputs[index];
  const witnessUtxo = input.witnessUtxo;

  if (!witnessUtxo) {
    throw new Error(`PSBT input ${index} is missing witnessUtxo data.`);
  }

  const expectedScript = role === 'sats' ? keySet.satsOutputScript : keySet.taprootOutputScript;

  if (!sameScript(Buffer.from(witnessUtxo.script), expectedScript)) {
    throw new Error(`PSBT input ${index} does not match ${address}.`);
  }
}

function parseOutputAddress(outputScript: Buffer, network: DucatNetwork): string {
  try {
    return btcAddress.fromOutputScript(outputScript, bitcoinNetwork(network));
  } catch {
    const chunks = btcScript.decompile(outputScript);
    if (chunks?.length === 2 && chunks[0] === opcodes.OP_RETURN && Buffer.isBuffer(chunks[1])) {
      return `OP_RETURN ${chunks[1].toString('hex')}`;
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
  try {
    return Psbt.fromBase64(psbtBase64, { network: bitcoinNetwork(network) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Malformed PSBT: ${message}`);
  }
}

export function summarizePsbt(psbt: Psbt, network: DucatNetwork, keySet: AccountKeySet, signInputs: SignInputs): PsbtSummary {
  const inputValueSats = psbt.data.inputs.reduce<number | null>((total, input) => {
    if (total === null || !input.witnessUtxo) {
      return null;
    }

    return total + input.witnessUtxo.value;
  }, 0);
  const outputs: PsbtOutputSummary[] = psbt.txOutputs.map((output) => {
    const outputAddress = output.address ?? parseOutputAddress(Buffer.from(output.script), network);

    return {
      address: outputAddress,
      valueSats: output.value,
      isMine: outputAddress === keySet.record.sats.address || outputAddress === keySet.record.runes.address,
    };
  });
  const outputValueSats = outputs.reduce((total, output) => total + output.valueSats, 0);

  return {
    network,
    inputCount: psbt.data.inputs.length,
    signedInputIndexes: allSignedInputIndexes(signInputs),
    outputCount: outputs.length,
    outputs,
    feeSats: inputValueSats === null ? null : inputValueSats - outputValueSats,
    inputValueSats,
    outputValueSats,
  };
}

export function preparePsbtForSigning(psbtBase64: string, network: DucatNetwork, keySet: AccountKeySet, signInputs: SignInputs): {
  psbt: Psbt;
  summary: PsbtSummary;
} {
  const psbt = parsePsbt(psbtBase64, network);

  for (const [inputAddress, indexes] of Object.entries(signInputs)) {
    if (!Array.isArray(indexes) || indexes.length === 0) {
      throw new Error(`No input indexes supplied for ${inputAddress}.`);
    }

    for (const index of indexes) {
      assertPsbtInputIndex(psbt, index);
      assertInputMatchesAddress(psbt, index, inputAddress, keySet);
    }
  }

  return {
    psbt,
    summary: summarizePsbt(psbt, network, keySet, signInputs),
  };
}

export function signPreparedPsbt(psbt: Psbt, keySet: AccountKeySet, signInputs: SignInputs): string {
  for (const [inputAddress, indexes] of Object.entries(signInputs)) {
    const role = getRoleForAddress(keySet, inputAddress);

    if (!role) {
      throw new Error(`Address ${inputAddress} is not managed by the Ducat Snap.`);
    }

    for (const index of indexes) {
      if (role === 'sats') {
        psbt.signInput(index, toSigner(keySet.satsNode));
      } else {
        const currentTapInternalKey = psbt.data.inputs[index].tapInternalKey;

        if (currentTapInternalKey && !Buffer.from(currentTapInternalKey).equals(keySet.taprootInternalPubkey)) {
          throw new Error(`PSBT input ${index} has a tapInternalKey that does not match the Ducat Snap account.`);
        }

        if (!currentTapInternalKey) {
          psbt.updateInput(index, { tapInternalKey: keySet.taprootInternalPubkey });
        }

        psbt.signTaprootInput(index, taprootSigner(keySet.taprootNode));
      }
    }
  }

  return psbt.toBase64();
}
