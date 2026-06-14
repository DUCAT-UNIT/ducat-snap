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

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);

  return buffer;
}

function vaultReturnPayload(flag: string, unitBalanceCents: number, unitPrice: number, unitTimestamp: number, tholdPrice?: number): Buffer {
  return Buffer.concat([
    Buffer.from([1, flag.charCodeAt(0)]),
    uint32(unitBalanceCents),
    uint32(unitPrice),
    uint32(unitTimestamp),
    ...(unitBalanceCents > 0 ? [uint32(tholdPrice ?? 45_000), Buffer.alloc(20, 12)] : []),
  ]);
}

function vaultSequence(actionCode: number): number {
  return (0xc0000000 | (actionCode << 8) | 1) >>> 0;
}

function priceCommit(unitPrice: number, tholdPrice: number, marker: number): Buffer {
  return Buffer.concat([
    Buffer.from([marker]),
    uint32(unitPrice),
    uint32(tholdPrice),
    Buffer.alloc(20, marker),
    Buffer.alloc(64, marker + 1),
  ]);
}

function coreVaultReturnPayload(unitBalanceCents: number, unitPrice: number, unitTimestamp: number, tholdPrice: number, commits = [priceCommit(unitPrice, tholdPrice, 12)]): Buffer {
  return Buffer.concat([
    Buffer.from([1, 1, 0]),
    uint32(unitBalanceCents),
    uint32(unitTimestamp),
    Buffer.from([commits.length]),
    ...commits,
  ]);
}

function addCoreVaultActionPsbtOutputs(psbt: Psbt, keySet: ReturnType<typeof makeKeySet>, actionCode: number, vaultValueSats: number, payload: Buffer): void {
  if (actionCode === 161) {
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 1_000,
    });
    psbt.addOutput({
      address: keySet.record.runes.address,
      value: 1_000,
    });
    psbt.addOutput({
      address: keySet.record.vault.address,
      value: vaultValueSats,
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 898_000,
    });
    psbt.addOutput({
      script: btcScript.compile([opcodes.OP_RETURN, opcodes.OP_8, payload]),
      value: 0,
    });

    return;
  }

  if (actionCode === 164) {
    psbt.addOutput({
      address: keySet.record.runes.address,
      value: 1_000,
    });
  }

  psbt.addOutput({
    address: keySet.record.vault.address,
    value: vaultValueSats,
  });
  psbt.addOutput({
    address: keySet.record.sats.address,
    value: 899_000,
  });
  psbt.addOutput({
    script: btcScript.compile([opcodes.OP_RETURN, opcodes.OP_8, payload]),
    value: 0,
  });
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

  it('rejects signed inputs that omit previous-output value data', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '12'.repeat(32),
      index: 0,
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] })).toThrow(
      'missing required input value data',
    );
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

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.runes.address]: [0] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_INPUT_ACCOUNT_MISMATCH',
        details: expect.objectContaining({
          actualAddress: keySet.record.sats.address,
        }),
      });
    }
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

    expect(prepared.summary.warnings).toEqual([]);
    expect(signed.data.inputs[0].tapScriptSig).toHaveLength(1);
    expect(signed.data.inputs[0].tapKeySig).toBeUndefined();
  });

  it('rejects Taproot script-path inputs when the vault leaf is not committed to the prevout', () => {
    const keySet = makeKeySet();
    const scriptPath = makeScriptPathPayment(keySet.taprootInternalPubkey);
    const differentScriptPath = makeScriptPathPayment(Buffer.alloc(32, 9));
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '44'.repeat(32),
      index: 0,
      tapLeafScript: [
        {
          controlBlock: scriptPath.controlBlock,
          leafVersion: 0xc0,
          script: scriptPath.redeemScript,
        },
      ],
      witnessUtxo: {
        script: differentScriptPath.output,
        value: 10_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    const signInputs = { [keySet.record.vault.address]: [0] };

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, signInputs)).toThrow('different Ducat Snap account');
  });

  it('rejects duplicate previous outputs before signing', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    for (const [inputIndex, hashByte] of [0x55, 0x58].entries()) {
      psbt.addInput({
        hash: hashByte.toString(16).repeat(32),
        index: inputIndex,
        witnessUtxo: {
          script: keySet.satsOutputScript,
          value: 10_000,
        },
      });
      psbt.addOutput({
        address: keySet.record.sats.address,
        value: inputIndex === 0 ? 9_000 : 8_000,
      });
    }

    const txInputs = (
      psbt as unknown as {
        __CACHE: { __TX: { ins: { hash: Buffer; index: number }[] } };
      }
    ).__CACHE.__TX.ins;

    txInputs[1].hash = Buffer.from(txInputs[0].hash);
    txInputs[1].index = txInputs[0].index;

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_DUPLICATE_INPUT',
        details: expect.objectContaining({ diagnostic: expect.stringContaining('Duplicate input') }),
      });
    }
  });

  it('rejects PSBTs with too many inputs before signing', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    for (let inputIndex = 0; inputIndex < 81; inputIndex += 1) {
      psbt.addInput({
        hash: Buffer.alloc(32, inputIndex + 1).toString('hex'),
        index: 0,
        witnessUtxo: {
          script: keySet.satsOutputScript,
          value: 1_000,
        },
      });
    }
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 80_000,
    });

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_TOO_LARGE',
        details: expect.objectContaining({
          inputCount: 81,
          maxInputs: 80,
        }),
      });
    }
  });

  it('rejects PSBTs with too many outputs before signing', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '59'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 200_000,
      },
    });
    for (let outputIndex = 0; outputIndex < 121; outputIndex += 1) {
      psbt.addOutput({
        address: keySet.record.sats.address,
        value: 1,
      });
    }

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_TOO_LARGE',
        details: expect.objectContaining({
          maxOutputs: 120,
          outputCount: 121,
        }),
      });
    }
  });

  it('labels bare OP_RETURN outputs as data outputs', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '56'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 10_000,
      },
    });
    psbt.addOutput({
      script: btcScript.compile([opcodes.OP_RETURN]),
      value: 0,
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });

    expect(prepared.summary.outputs[0]).toMatchObject({
      address: 'OP_RETURN',
      role: 'op_return',
      valueSats: 0,
    });
  });

  it('warns for suspicious zero-value unknown scripts and value-bearing OP_RETURN outputs', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '57'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 10_000,
      },
    });
    psbt.addOutput({
      script: btcScript.compile([opcodes.OP_RETURN, Buffer.from('burn', 'utf8')]),
      value: 1,
    });
    psbt.addOutput({
      script: btcScript.compile([Buffer.from([1, 2, 3]), opcodes.OP_DROP]),
      value: 0,
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 8_000,
    });

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });

    expect(prepared.summary.outputs[0]).toMatchObject({ role: 'op_return', valueSats: 1 });
    expect(prepared.summary.outputs[1]).toMatchObject({ role: 'unknown', valueSats: 0 });
    expect(prepared.summary.warnings).toEqual([
      'An OP_RETURN data output carries BTC value. Those sats are provably unspendable.',
      'A zero-value unknown-script output is present. Review the script data before signing.',
    ]);
  });

  it('decodes Ducat vault return data from OP_RETURN outputs', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });
    const payload = vaultReturnPayload('d', 50_000, 60_000, 123_456, 45_000);

    psbt.addInput({
      hash: '66'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 2_000_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.vault.address,
      value: 1_100_000,
    });
    psbt.addOutput({
      script: btcScript.compile([opcodes.OP_RETURN, opcodes.OP_8, payload]),
      value: 0,
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 899_000,
    });

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });

    expect(prepared.summary.vaultUpdates).toHaveLength(1);
    expect(prepared.summary.outputs[1].address).toContain('OP_RETURN OP_8');
    expect(prepared.summary.outputs[1].vaultData).toMatchObject({
      actionFlag: 'd',
      actionType: 'deposit',
      collateralSats: 1_100_000,
      isLocked: true,
      outputIndex: 1,
      tholdHash: Buffer.alloc(20, 12).toString('hex'),
      tholdPrice: 45_000,
      unitBalanceCents: 50_000,
      unitBalanceUnit: 500,
      unitPrice: 60_000,
      unitTimestamp: 123_456,
    });
    expect(prepared.summary.warnings).toEqual([]);
  });

  it('decodes current Ducat core vault return data from OP_RETURN outputs', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });
    const payload = coreVaultReturnPayload(50_000, 60_000, 123_456, 45_000, [priceCommit(70_000, 50_000, 11), priceCommit(60_000, 45_000, 12)]);

    psbt.addInput({
      hash: '77'.repeat(32),
      index: 0,
      sequence: vaultSequence(166),
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 2_000_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.vault.address,
      value: 1_100_000,
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 899_000,
    });
    psbt.addOutput({
      script: btcScript.compile([opcodes.OP_RETURN, opcodes.OP_8, payload]),
      value: 0,
    });

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });

    expect(prepared.summary.vaultUpdates).toHaveLength(1);
    expect(prepared.summary.outputs[2].vaultData).toMatchObject({
      actionFlag: 'd',
      actionType: 'deposit',
      collateralSats: 1_100_000,
      guardianCount: 1,
      isLocked: true,
      outputIndex: 2,
      priceCommitCount: 2,
      tholdHash: Buffer.alloc(20, 12).toString('hex'),
      tholdPrice: 45_000,
      unitBalanceCents: 50_000,
      unitBalanceUnit: 500,
      unitPrice: 60_000,
      unitTimestamp: 123_456,
    });
    expect(prepared.summary.warnings).toEqual([]);
  });

  it.each([
    { actionCode: 161, actionFlag: 'o', actionType: 'create', protocolAction: 'open', vaultOutputIndex: 2, expectedDataOutputIndex: 4 },
    { actionCode: 164, actionFlag: 'b', actionType: 'borrow', protocolAction: 'borrow', vaultOutputIndex: 1 },
    { actionCode: 165, actionFlag: 'r', actionType: 'repay', protocolAction: 'repay', vaultOutputIndex: 0 },
    { actionCode: 167, actionFlag: 'w', actionType: 'withdraw', protocolAction: 'withdraw', vaultOutputIndex: 0 },
    { actionCode: 168, actionFlag: 'x', actionType: 'repo', protocolAction: 'repo', vaultOutputIndex: 0 },
    { actionCode: 169, actionFlag: 'l', actionType: 'liquidate', protocolAction: 'trim', vaultOutputIndex: 0 },
  ])('decodes current Ducat core $actionType vault action data', ({ actionCode, actionFlag, actionType, protocolAction, vaultOutputIndex, expectedDataOutputIndex }) => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });
    const payload = coreVaultReturnPayload(75_000, 58_000, 654_321, 43_500);

    psbt.addInput({
      hash: actionCode.toString(16).padStart(2, '0').repeat(32),
      index: 0,
      sequence: vaultSequence(actionCode),
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 2_500_000,
      },
    });
    addCoreVaultActionPsbtOutputs(psbt, keySet, actionCode, 1_250_000, payload);

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });
    const vaultData = prepared.summary.vaultUpdates[0];

    expect(prepared.summary.vaultUpdates).toHaveLength(1);
    expect(vaultData).toMatchObject({
      actionFlag,
      actionType,
      collateralSats: 1_250_000,
      outputIndex: expectedDataOutputIndex ?? vaultOutputIndex + 2,
      protocolAction,
      sequenceCode: actionCode,
      sequenceVersion: 1,
      tholdPrice: 43_500,
      unitBalanceCents: 75_000,
      unitBalanceUnit: 750,
      unitPrice: 58_000,
      unitTimestamp: 654_321,
    });
    expect(prepared.summary.warnings).toEqual([]);
  });

  it('warns when a Ducat-looking OP_RETURN cannot be decoded', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '88'.repeat(32),
      index: 0,
      sequence: vaultSequence(166),
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 10_000,
      },
    });
    psbt.addOutput({
      script: btcScript.compile([opcodes.OP_RETURN, opcodes.OP_8, Buffer.from([1, 1])]),
      value: 0,
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });

    expect(prepared.summary.outputs[0].vaultData).toBeUndefined();
    expect(prepared.summary.warnings).toEqual(['A Ducat-looking OP_RETURN output was present but could not be decoded as vault return data.']);
  });

});
