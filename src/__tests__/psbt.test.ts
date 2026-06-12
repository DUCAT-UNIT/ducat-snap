import { opcodes, payments, Psbt, script as btcScript } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { bitcoinNetwork } from '../networks';
import { preparePsbtForSigning, signPreparedPsbt } from '../psbt';

const UNSPENDABLE_TAPROOT_KEY = Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex');

function makeKeySet() {
  return deriveAccountSetFromBaseNodes(
    'signet',
    DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 3), Buffer.alloc(32, 13)),
    DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 4), Buffer.alloc(32, 14)),
  );
}

function makeScriptPathPayment(xOnlyPubkey: Buffer) {
  const redeemScript = btcScript.compile([xOnlyPubkey, opcodes.OP_CHECKSIG]);
  const payment = payments.p2tr({
    internalPubkey: UNSPENDABLE_TAPROOT_KEY,
    network: bitcoinNetwork('signet'),
    redeem: {
      output: redeemScript,
      redeemVersion: 0xc0,
    },
    scriptTree: {
      output: redeemScript,
    },
  });

  if (!payment.output || !payment.witness?.length) {
    throw new Error('Failed to build script-path Taproot test payment.');
  }

  return {
    output: payment.output,
    redeemScript,
    controlBlock: payment.witness[payment.witness.length - 1],
  };
}

describe('PSBT signing', () => {
  it('signs only explicit derived P2WPKH indexes', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '00'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 100_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 99_000,
    });

    const signInputs = { [keySet.record.sats.address]: [0] };
    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, signInputs);
    const signed = Psbt.fromBase64(signPreparedPsbt(prepared.psbt, keySet, signInputs), { network: bitcoinNetwork('signet') });

    expect(signed.data.inputs[0].partialSig).toHaveLength(1);
  });

  it('rejects unknown signer addresses', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '11'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 10_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { tb1qunknown: [0] })).toThrow('not managed');
  });

  it('reports the actual input address when a signer address does not match the PSBT input script', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '22'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 10_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.runes.address]: [0] })).toThrow(
      `Actual input address: ${keySet.record.sats.address}.`,
    );
  });

  it('signs committed Taproot script-path inputs that contain the derived vault pubkey', () => {
    const keySet = makeKeySet();
    const scriptPath = makeScriptPathPayment(keySet.taprootInternalPubkey);
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '33'.repeat(32),
      index: 0,
      tapLeafScript: [
        {
          controlBlock: scriptPath.controlBlock,
          leafVersion: 0xc0,
          script: scriptPath.redeemScript,
        },
      ],
      witnessUtxo: {
        script: scriptPath.output,
        value: 10_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    const signInputs = { [keySet.record.vault.address]: [0] };
    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, signInputs);
    const signed = Psbt.fromBase64(signPreparedPsbt(prepared.psbt, keySet, signInputs), { network: bitcoinNetwork('signet') });

    expect(signed.data.inputs[0].tapScriptSig).toHaveLength(1);
    expect(signed.data.inputs[0].tapKeySig).toBeUndefined();
  });
});
