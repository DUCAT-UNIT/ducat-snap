/** @fileoverview Constructs and signs BIP-322 simple messages for managed P2WPKH and Taproot roles. */
import { crypto, opcodes, Psbt, Transaction } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { getInternalPubkeyForRole, getNodeForRole, getOutputScriptForRole, type AccountKeySet } from './accounts';
import { bitcoinNetwork, bitcoinNetworkForDeployment } from './networks';
import { taprootSigner, toSigner } from './psbt';
import type { DucatAddressRole } from './types';

/** @param message - UTF-8 message text. @returns The BIP-322 tagged digest `sha256(tagHash || tagHash || message)`. */
export function bip322MessageHash(message: string): Buffer {
  const tagHash = crypto.sha256(Buffer.from('BIP0322-signed-message'));

  return crypto.sha256(Buffer.concat([tagHash, tagHash, Buffer.from(message)]));
}

function buildToSpendTx(message: string, scriptPubKey: Buffer): Transaction {
  const tx = new Transaction();
  const messageHash = bip322MessageHash(message);
  const scriptSig = Buffer.concat([Buffer.from([opcodes.OP_0, 0x20]), messageHash]);

  tx.version = 0;
  tx.locktime = 0;
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0, scriptSig);
  tx.addOutput(scriptPubKey, 0);

  return tx;
}

function buildToSignPsbt(params: {
  keySet: AccountKeySet;
  role: DucatAddressRole;
  toSpendTxId: string;
  scriptPubKey: Buffer;
}): Psbt {
  const psbt = new Psbt({ network: bitcoinNetwork(bitcoinNetworkForDeployment(params.keySet.network)) });

  psbt.setVersion(0);
  psbt.setLocktime(0);
  psbt.addInput({
    hash: params.toSpendTxId,
    index: 0,
    sequence: 0,
    witnessUtxo: {
      script: params.scriptPubKey,
      value: 0,
    },
    ...(params.role === 'sats'
      ? {}
      : {
          tapInternalKey: getInternalPubkeyForRole(params.keySet, params.role),
          sighashType: Transaction.SIGHASH_ALL,
        }),
  });
  psbt.addOutput({
    script: Buffer.from([opcodes.OP_RETURN]),
    value: 0,
  });

  return psbt;
}

/**
 * Constructs and signs a BIP-322 simple-message witness with a managed role key.
 * @param params - Message, selected role, network, and active key set.
 * @returns Base64 BIP-322 witness and signer metadata.
 * @throws When the selected role cannot sign the requested address form.
 */
export function signBip322SimpleMessage(params: {
  keySet: AccountKeySet;
  role: DucatAddressRole;
  message: string;
}): { signature: string; messageHash: string } {
  const scriptPubKey = getOutputScriptForRole(params.keySet, params.role);
  const toSpendTx = buildToSpendTx(params.message, scriptPubKey);
  const toSignPsbt = buildToSignPsbt({
    keySet: params.keySet,
    role: params.role,
    toSpendTxId: toSpendTx.getId(),
    scriptPubKey,
  });

  if (params.role === 'sats') {
    toSignPsbt.signInput(0, toSigner(params.keySet.satsNode), [Transaction.SIGHASH_ALL]);
  } else {
    toSignPsbt.signTaprootInput(0, taprootSigner(getNodeForRole(params.keySet, params.role)), undefined, [Transaction.SIGHASH_ALL]);
  }

  toSignPsbt.finalizeAllInputs();

  const finalScriptWitness = toSignPsbt.data.inputs[0]?.finalScriptWitness;

  if (!finalScriptWitness) {
    throw new Error('Failed to produce BIP322 witness.');
  }

  return {
    signature: Buffer.from(finalScriptWitness).toString('base64'),
    messageHash: bip322MessageHash(params.message).toString('hex'),
  };
}
