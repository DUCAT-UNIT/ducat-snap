import { networks as btcNetworks, opcodes, payments, Psbt, script as btcScript, Transaction } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { bitcoinNetwork, DUCAT_GUARDIAN_PUBKEYS } from '../networks';
import { preparePsbtForSigning, signPreparedPsbt } from '../psbt';

const UNSPENDABLE_TAPROOT_KEY = Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex');
// The approved Ducat guardian key (matches DUCAT_GUARDIAN_PUBKEYS in networks.ts).
const GUARD_TAPROOT_KEY = Buffer.from(DUCAT_GUARDIAN_PUBKEYS.signet[0], 'hex');
// A guard key that is NOT on the guardian allowlist, used to assert enforcement.
const UNAPPROVED_GUARD_TAPROOT_KEY = Buffer.alloc(32, 8);

function makeKeySet() {
  return deriveAccountSetFromBaseNodes(
    'signet',
    DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 3), Buffer.alloc(32, 13)),
    DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 4), Buffer.alloc(32, 14)),
  );
}

function makeScriptPathPayment(xOnlyPubkey: Buffer) {
  const redeemScript = btcScript.compile([xOnlyPubkey, opcodes.OP_CHECKSIG]);
  return makeTaprootScriptPathPayment(redeemScript);
}

function makeCosignScriptPathPayment(vaultXOnlyPubkey: Buffer) {
  const redeemScript = btcScript.compile([vaultXOnlyPubkey, opcodes.OP_CHECKSIGVERIFY, GUARD_TAPROOT_KEY, opcodes.OP_CHECKSIG]);
  return makeTaprootScriptPathPayment(redeemScript);
}

function makeUnapprovedGuardCosignScriptPathPayment(vaultXOnlyPubkey: Buffer) {
  const redeemScript = btcScript.compile([vaultXOnlyPubkey, opcodes.OP_CHECKSIGVERIFY, UNAPPROVED_GUARD_TAPROOT_KEY, opcodes.OP_CHECKSIG]);
  return makeTaprootScriptPathPayment(redeemScript);
}

function makeDuplicateKeyCosignScriptPathPayment(vaultXOnlyPubkey: Buffer) {
  const redeemScript = btcScript.compile([vaultXOnlyPubkey, opcodes.OP_CHECKSIGVERIFY, vaultXOnlyPubkey, opcodes.OP_CHECKSIG]);
  return makeTaprootScriptPathPayment(redeemScript);
}

function makeTaprootScriptPathPayment(redeemScript: Buffer) {
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

  it('rejects wrong-network signer addresses even when the input script matches the account key', () => {
    const keySet = makeKeySet();
    const wrongNetworkAddress = payments.p2wpkh({
      pubkey: Buffer.from(keySet.record.sats.pubkey, 'hex'),
      network: btcNetworks.bitcoin,
    }).address;
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    if (!wrongNetworkAddress) {
      throw new Error('Failed to derive wrong-network test address.');
    }

    psbt.addInput({
      hash: '10'.repeat(32),
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

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [wrongNetworkAddress]: [0] })).toThrow('not managed');
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

  it('rejects requested input indexes that do not exist in the PSBT', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '13'.repeat(32),
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
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [1] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_INPUT_INDEX_INVALID',
        details: expect.objectContaining({
          inputCount: 1,
          inputIndex: 1,
        }),
      });
    }
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

  it('rejects mixed-account PSBTs when any requested input belongs to another account', () => {
    const keySet = makeKeySet();
    const externalKeySet = deriveAccountSetFromBaseNodes(
      'signet',
      DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 5), Buffer.alloc(32, 15)),
      DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 6), Buffer.alloc(32, 16)),
    );
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '23'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 10_000,
      },
    });
    psbt.addInput({
      hash: '24'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: externalKeySet.satsOutputScript,
        value: 10_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 18_000,
    });

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0, 1] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_INPUT_ACCOUNT_MISMATCH',
        details: expect.objectContaining({
          actualAddress: externalKeySet.record.sats.address,
          inputIndex: 1,
          requestedAddress: keySet.record.sats.address,
        }),
      });
    }
  });

  it('signs committed Ducat cosign script-path inputs for the derived vault pubkey', () => {
    const keySet = makeKeySet();
    const scriptPath = makeCosignScriptPathPayment(keySet.vaultInternalPubkey);
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
    expect(prepared.summary.signedInputs[0]).toMatchObject({
      role: 'vault',
      verification: 'committed-ducat-cosign-leaf',
    });
    expect(signed.data.inputs[0].tapScriptSig).toHaveLength(1);
    expect(signed.data.inputs[0].tapScriptSig?.[0].leafHash).toBeDefined();
    expect(signed.data.inputs[0].tapKeySig).toBeUndefined();
  });

  it('rejects committed Taproot script-path inputs that are not Ducat cosign leaves', () => {
    const keySet = makeKeySet();
    const scriptPath = makeScriptPathPayment(keySet.vaultInternalPubkey);
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '34'.repeat(32),
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

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.vault.address]: [0] })).toThrow(
      'different Ducat Snap account',
    );
  });

  it('rejects committed cosign-looking leaves that reuse the vault key as the guard key', () => {
    const keySet = makeKeySet();
    const scriptPath = makeDuplicateKeyCosignScriptPathPayment(keySet.vaultInternalPubkey);
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '38'.repeat(32),
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

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.vault.address]: [0] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_INPUT_ACCOUNT_MISMATCH',
        details: expect.objectContaining({
          taprootScriptPathCheck: 'no tapLeafScript is a Ducat cosign leaf for the derived vault pubkey',
        }),
      });
    }
  });

  it('rejects Taproot script-path inputs when the vault leaf is not committed to the prevout', () => {
    const keySet = makeKeySet();
    const scriptPath = makeCosignScriptPathPayment(keySet.vaultInternalPubkey);
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

  it('warns when a Ducat-looking OP_RETURN exceeds the bounded oracle commitment policy', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });
    const oversizedPayload = coreVaultReturnPayload(50_000, 60_000, 123_456, 45_000, [
      priceCommit(60_000, 45_000, 12),
      priceCommit(59_000, 44_000, 13),
      priceCommit(58_000, 43_000, 14),
      priceCommit(57_000, 42_000, 15),
    ]);

    psbt.addInput({
      hash: '89'.repeat(32),
      index: 0,
      sequence: vaultSequence(166),
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 10_000,
      },
    });
    psbt.addOutput({
      script: btcScript.compile([opcodes.OP_RETURN, opcodes.OP_8, oversizedPayload]),
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

  it('rejects a sats input whose nonWitnessUtxo value disagrees with the displayed witnessUtxo value', () => {
    const keySet = makeKeySet();
    const prevTx = new Transaction();
    prevTx.version = 2;
    prevTx.addInput(Buffer.alloc(32, 9), 0);
    prevTx.addOutput(keySet.satsOutputScript, 100_000_000); // REAL value: 1 BTC at vout 0

    const psbt = new Psbt({ network: bitcoinNetwork('signet') });
    psbt.addInput({
      hash: prevTx.getId(),
      index: 0,
      nonWitnessUtxo: prevTx.toBuffer(),
      witnessUtxo: { script: keySet.satsOutputScript, value: 10_000 }, // LYING value the dialog would show
    });
    psbt.addOutput({ address: keySet.record.sats.address, value: 9_500 });

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_INPUT_VALUE_MISMATCH',
        details: expect.objectContaining({
          inputIndex: 0,
          witnessUtxoValueSats: 10_000,
          nonWitnessUtxoValueSats: 100_000_000,
        }),
      });
    }
  });

  it('accepts a sats input whose nonWitnessUtxo value matches the displayed witnessUtxo value', () => {
    const keySet = makeKeySet();
    const prevTx = new Transaction();
    prevTx.version = 2;
    prevTx.addInput(Buffer.alloc(32, 9), 0);
    prevTx.addOutput(keySet.satsOutputScript, 100_000);

    const psbt = new Psbt({ network: bitcoinNetwork('signet') });
    psbt.addInput({
      hash: prevTx.getId(),
      index: 0,
      nonWitnessUtxo: prevTx.toBuffer(),
      witnessUtxo: { script: keySet.satsOutputScript, value: 100_000 },
    });
    psbt.addOutput({ address: keySet.record.sats.address, value: 99_000 });

    const signInputs = { [keySet.record.sats.address]: [0] };
    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, signInputs);
    const signed = Psbt.fromBase64(signPreparedPsbt(prepared.psbt, keySet, signInputs), { network: bitcoinNetwork('signet') });

    expect(signed.data.inputs[0].partialSig).toHaveLength(1);
  });

  it('rejects inputs requesting a non-default sighash type before signing', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '61'.repeat(32),
      index: 0,
      sighashType: Transaction.SIGHASH_NONE,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: 100_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 99_000,
    });

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.sats.address]: [0] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_SIGHASH_NOT_ALLOWED',
        details: expect.objectContaining({
          inputIndex: 0,
          requestedSighashType: Transaction.SIGHASH_NONE,
        }),
      });
    }
  });

  it('surfaces the cosign guard pubkey on committed cosign script-path inputs', () => {
    const keySet = makeKeySet();
    const scriptPath = makeCosignScriptPathPayment(keySet.vaultInternalPubkey);
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '62'.repeat(32),
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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.vault.address]: [0] });

    expect(prepared.summary.signedInputs[0]).toMatchObject({
      role: 'vault',
      verification: 'committed-ducat-cosign-leaf',
      cosignGuardPubkey: GUARD_TAPROOT_KEY.toString('hex'),
      // The guard key is on the configured guardian allowlist, so it is marked verified.
      cosignGuardianKnown: true,
    });
  });

  it('rejects committed cosign leaves whose guard key is not an approved Ducat guardian', () => {
    const keySet = makeKeySet();
    const scriptPath = makeUnapprovedGuardCosignScriptPathPayment(keySet.vaultInternalPubkey);
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '63'.repeat(32),
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

    try {
      preparePsbtForSigning(psbt.toBase64(), 'signet', keySet, { [keySet.record.vault.address]: [0] });
      throw new Error('Expected preparePsbtForSigning to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PSBT_INPUT_ACCOUNT_MISMATCH',
        details: expect.objectContaining({
          taprootScriptPathCheck: expect.stringContaining('not an approved Ducat guardian'),
        }),
      });
    }
  });

});
