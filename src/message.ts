import { crypto, opcodes, Psbt, Transaction } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import type { AccountKeySet } from './accounts';
import { bitcoinNetwork } from './networks';
import { taprootSigner, toSigner } from './psbt';
import type { DucatAddressRole } from './types';

function buildToSpendTx(message: string, scriptPubKey: Buffer): Transaction {
  const tx = new Transaction();
  const tagHash = crypto.sha256(Buffer.from('BIP0322-signed-message'));
  const messageHash = crypto.sha256(Buffer.concat([tagHash, tagHash, Buffer.from(message)]));
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
  const psbt = new Psbt({ network: bitcoinNetwork(params.keySet.network) });

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
          tapInternalKey: params.keySet.taprootInternalPubkey,
          sighashType: Transaction.SIGHASH_ALL,
        }),
  });
  psbt.addOutput({
    script: Buffer.from([opcodes.OP_RETURN]),
    value: 0,
  });

  return psbt;
}

export function signBip322SimpleMessage(params: {
  keySet: AccountKeySet;
  role: DucatAddressRole;
  message: string;
}): string {
  const scriptPubKey = params.role === 'sats' ? params.keySet.satsOutputScript : params.keySet.taprootOutputScript;
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
    toSignPsbt.signTaprootInput(0, taprootSigner(params.keySet.taprootNode), undefined, [Transaction.SIGHASH_ALL]);
  }

  toSignPsbt.finalizeAllInputs();

  const finalScriptWitness = toSignPsbt.data.inputs[0]?.finalScriptWitness;

  if (!finalScriptWitness) {
    throw new Error('Failed to produce BIP322 witness.');
  }

  return Buffer.from(finalScriptWitness).toString('base64');
}
