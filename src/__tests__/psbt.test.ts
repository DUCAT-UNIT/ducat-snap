import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { networks as btcNetworks, opcodes, payments, Psbt, script as btcScript, Transaction } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

// Validator that proves a signature verifies against the sighash bitcoinjs-lib recomputes from the
// FULL input set. bitcoinjs passes a 32-byte x-only pubkey for taproot inputs and a 33-byte
// compressed pubkey for ECDSA inputs, so the pubkey length is the reliable discriminator (a raw
// ECDSA signature is also 64 bytes, so signature length is NOT). validateSignaturesOf* recomputes
// the sighash over every prevout, so a `true` result is positive proof that the signature commits
// to all inputs' prevouts — not merely that signing did not throw.
const sigValidator = (pubkey: Buffer, msghash: Buffer, signature: Buffer): boolean =>
  pubkey.length === 32 ? ecc.verifySchnorr(msghash, pubkey, signature) : ecc.verify(msghash, pubkey, signature);

import { DucatKeyNode } from '../bip32';
import { bitcoinNetwork, DUCAT_GUARDIAN_PUBKEYS } from '../networks';
import { preparePsbtForSigning, signPreparedPsbt } from '../psbt';
import type { DucatVaultActionFlag } from '../types';
import { deriveAccountSetFromBaseNodes } from './helpers/accounts';

const UNSPENDABLE_TAPROOT_KEY = Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex');
// The approved Ducat guardian key (matches DUCAT_GUARDIAN_PUBKEYS in networks.ts).
const GUARD_TAPROOT_KEY = Buffer.from(DUCAT_GUARDIAN_PUBKEYS.mutinynet[0], 'hex');
// A guard key that is NOT on the guardian allowlist, used to assert enforcement.
const UNAPPROVED_GUARD_TAPROOT_KEY = Buffer.alloc(32, 8);

function makeKeySet() {
  return deriveAccountSetFromBaseNodes(
    'mutinynet',
    DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 3), Buffer.alloc(32, 13)),
    DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 4), Buffer.alloc(32, 14)),
  );
}

function makeSharedTaprootKeySet() {
  const keySet = makeKeySet();

  return {
    ...keySet,
    record: {
      ...keySet.record,
      vault: { ...keySet.record.runes },
    },
    vaultNode: keySet.runesNode,
    vaultOutputScript: keySet.runesOutputScript,
    vaultInternalPubkey: keySet.runesInternalPubkey,
  };
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

// The BitVM3 disprove leaf: `OP_SHA256 <H(L*)> OP_EQUALVERIFY OP_1`.
function bitvm3DisproveLeaf(labelHash: Buffer): Buffer {
  return btcScript.compile([opcodes.OP_SHA256, labelHash, opcodes.OP_EQUALVERIFY, opcodes.OP_1]);
}

// The BitVM3 timeout leaf: `<Δ> OP_CSV OP_DROP <operator_pk> OP_CHECKSIG`.
function bitvm3TimeoutLeaf(challengeWindow: number, operatorXOnlyPubkey: Buffer): Buffer {
  return btcScript.compile([
    btcScript.number.encode(challengeWindow),
    opcodes.OP_CHECKSEQUENCEVERIFY,
    opcodes.OP_DROP,
    operatorXOnlyPubkey,
    opcodes.OP_CHECKSIG,
  ]);
}

// Build the real 2-leaf BitVM3 assert output `[disprove, timeout]` (NUMS-keyed),
// returning the spend material for the TIMEOUT leaf (the operator reclaim path).
function makeBitvm3AssertTimeoutPayment(operatorXOnlyPubkey: Buffer, challengeWindow = 144) {
  const disprove = bitvm3DisproveLeaf(Buffer.alloc(32, 0xab));
  const timeout = bitvm3TimeoutLeaf(challengeWindow, operatorXOnlyPubkey);
  const payment = payments.p2tr({
    internalPubkey: UNSPENDABLE_TAPROOT_KEY,
    network: bitcoinNetwork('signet'),
    redeem: {
      output: timeout,
      redeemVersion: 0xc0,
    },
    scriptTree: [{ output: disprove }, { output: timeout }],
  });

  if (!payment.output || !payment.witness?.length) {
    throw new Error('Failed to build BitVM3 assert timeout test payment.');
  }

  return {
    output: payment.output,
    timeoutLeaf: timeout,
    controlBlock: payment.witness[payment.witness.length - 1],
  };
}

function makeOwnedBitvm3TimeoutPsbt({ sequence = 144, version = 2 }: { sequence?: number; version?: number } = {}) {
  const keySet = makeKeySet();
  const assert = makeBitvm3AssertTimeoutPayment(keySet.vaultInternalPubkey);
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.setVersion(version);
  psbt.addInput({
    hash: '5a'.repeat(32),
    index: 0,
    sequence,
    tapLeafScript: [
      {
        controlBlock: assert.controlBlock,
        leafVersion: 0xc0,
        script: assert.timeoutLeaf,
      },
    ],
    witnessUtxo: {
      script: assert.output,
      value: 10_000,
    },
  });
  psbt.addOutput({
    address: keySet.record.sats.address,
    value: 9_000,
  });

  return {
    keySet,
    psbt,
    signInputs: { [keySet.record.vault.address]: [0] },
  };
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
    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs);
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

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { tb1qunknown: [0] })).toThrow('not managed');
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

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [wrongNetworkAddress]: [0] })).toThrow('not managed');
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

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] })).toThrow(
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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [1] });
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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.runes.address]: [0] });
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
      'mutinynet',
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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0, 1] });
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
    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs);
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

  it('distinguishes runes and vault inputs when both roles share one Taproot key', () => {
    const keySet = makeSharedTaprootKeySet();
    const inscriptionSuffix = Buffer.from(
      '0063036f72640101106170706c69636174696f6e2f6a736f6e010714f04df4c4b30d2b7ac6e1ed2445aeb12a9cb4d2ec000e7b226c626c223a2244656d6f227d68',
      'hex',
    );
    const cosignPrefix = btcScript.compile([
      keySet.vaultInternalPubkey,
      opcodes.OP_CHECKSIGVERIFY,
      GUARD_TAPROOT_KEY,
      opcodes.OP_CHECKSIG,
    ]);
    const scriptPath = makeTaprootScriptPathPayment(Buffer.concat([cosignPrefix, inscriptionSuffix]));
    const vaultPsbt = new Psbt({ network: bitcoinNetwork('signet') });

    vaultPsbt.addInput({
      hash: '35'.repeat(32),
      index: 0,
      sequence: vaultSequence(161),
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
    vaultPsbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    const sharedAddress = keySet.record.runes.address;
    const vaultSignInputs = { [sharedAddress]: [0] };
    const preparedVault = preparePsbtForSigning(vaultPsbt.toBase64(), 'mutinynet', keySet, vaultSignInputs);
    const signedVault = Psbt.fromBase64(signPreparedPsbt(preparedVault.psbt, keySet, vaultSignInputs), {
      network: bitcoinNetwork('signet'),
    });

    expect(preparedVault.summary.signedInputs[0]).toMatchObject({
      role: 'vault',
      verification: 'committed-ducat-cosign-leaf',
    });
    expect(signedVault.data.inputs[0].tapScriptSig).toHaveLength(1);
    expect(signedVault.data.inputs[0].tapKeySig).toBeUndefined();

    const runesPsbt = new Psbt({ network: bitcoinNetwork('signet') });
    runesPsbt.addInput({
      hash: '36'.repeat(32),
      index: 0,
      tapInternalKey: keySet.runesInternalPubkey,
      witnessUtxo: {
        script: keySet.runesOutputScript,
        value: 10_000,
      },
    });
    runesPsbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    const runesSignInputs = { [sharedAddress]: [0] };
    const preparedRunes = preparePsbtForSigning(runesPsbt.toBase64(), 'mutinynet', keySet, runesSignInputs);
    const signedRunes = Psbt.fromBase64(signPreparedPsbt(preparedRunes.psbt, keySet, runesSignInputs), {
      network: bitcoinNetwork('signet'),
    });

    expect(preparedRunes.summary.signedInputs[0]).toMatchObject({
      role: 'runes',
      verification: 'matched-account-output',
    });
    expect(signedRunes.data.inputs[0].tapKeySig).toBeDefined();
    expect(signedRunes.data.inputs[0].tapScriptSig).toBeUndefined();
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

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.vault.address]: [0] })).toThrow(
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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.vault.address]: [0] });
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

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs)).toThrow('different Ducat Snap account');
  });

  it('signs a committed BitVM3 timeout (unilateral-exit reclaim) leaf for the derived vault pubkey', () => {
    const keySet = makeKeySet();
    const assert = makeBitvm3AssertTimeoutPayment(keySet.vaultInternalPubkey);
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '55'.repeat(32),
      index: 0,
      // nSequence must encode the relative timelock for OP_CSV to pass on-chain;
      // the Snap signs regardless, but we set it to mirror the real reclaim tx.
      sequence: 144,
      tapLeafScript: [
        {
          controlBlock: assert.controlBlock,
          leafVersion: 0xc0,
          script: assert.timeoutLeaf,
        },
      ],
      witnessUtxo: {
        script: assert.output,
        value: 10_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    const signInputs = { [keySet.record.vault.address]: [0] };
    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs);
    const signed = Psbt.fromBase64(signPreparedPsbt(prepared.psbt, keySet, signInputs), { network: bitcoinNetwork('signet') });

    expect(prepared.summary.warnings).toEqual([]);
    expect(prepared.summary.signedInputs[0]).toMatchObject({
      role: 'vault',
      verification: 'committed-bitvm3-timeout-leaf',
    });
    expect(signed.data.inputs[0].tapScriptSig).toHaveLength(1);
    expect(signed.data.inputs[0].tapScriptSig?.[0].leafHash).toBeDefined();
    expect(signed.data.inputs[0].tapKeySig).toBeUndefined();
  });

  it('rejects a BitVM3 timeout transaction with version below 2', () => {
    const { keySet, psbt, signInputs } = makeOwnedBitvm3TimeoutPsbt({ version: 1 });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs)).toThrow('relative timelock');
  });

  it('rejects a BitVM3 timeout input with the sequence-disable flag set', () => {
    const { keySet, psbt, signInputs } = makeOwnedBitvm3TimeoutPsbt({ sequence: 0x80000090 });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs)).toThrow('relative timelock');
  });

  it('rejects a BitVM3 block timeout input using time-based sequence units', () => {
    const { keySet, psbt, signInputs } = makeOwnedBitvm3TimeoutPsbt({ sequence: 0x00400090 });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs)).toThrow('relative timelock');
  });

  it('rejects a BitVM3 timeout input whose sequence is below the committed delay', () => {
    const { keySet, psbt, signInputs } = makeOwnedBitvm3TimeoutPsbt({ sequence: 143 });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs)).toThrow('relative timelock');
  });

  it('rejects a BitVM3 timeout leaf whose operator key is not the derived vault pubkey', () => {
    const keySet = makeKeySet();
    // Operator key in the leaf is a foreign key, not this Snap's vault key.
    const assert = makeBitvm3AssertTimeoutPayment(Buffer.alloc(32, 7));
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '56'.repeat(32),
      index: 0,
      sequence: 144,
      tapLeafScript: [
        {
          controlBlock: assert.controlBlock,
          leafVersion: 0xc0,
          script: assert.timeoutLeaf,
        },
      ],
      witnessUtxo: {
        script: assert.output,
        value: 10_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.vault.address]: [0] })).toThrow(
      'different Ducat Snap account',
    );
  });

  it('rejects a BitVM3 timeout leaf that is not committed to the prevout output', () => {
    const keySet = makeKeySet();
    const assert = makeBitvm3AssertTimeoutPayment(keySet.vaultInternalPubkey);
    // A different assert output the leaf is NOT committed to.
    const otherAssert = makeBitvm3AssertTimeoutPayment(Buffer.alloc(32, 9));
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: '57'.repeat(32),
      index: 0,
      sequence: 144,
      tapLeafScript: [
        {
          controlBlock: assert.controlBlock,
          leafVersion: 0xc0,
          script: assert.timeoutLeaf,
        },
      ],
      witnessUtxo: {
        script: otherAssert.output,
        value: 10_000,
      },
    });
    psbt.addOutput({
      address: keySet.record.sats.address,
      value: 9_000,
    });

    expect(() => preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.vault.address]: [0] })).toThrow(
      'different Ducat Snap account',
    );
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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });
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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });
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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });
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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });

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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });

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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });

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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });

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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });
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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });

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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });

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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });
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
    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs);
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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });
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

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.vault.address]: [0] });

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
      preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.vault.address]: [0] });
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

// Parity with the wallet-snap MVP (DUCAT-UNIT/wallet-snap). These tests assert that
// ducat-snap classifies and signs every scenario wallet-snap can, so nothing is lost by
// keeping ducat-snap canonical. Verified equivalences this locks in:
//   1. Vault-action classification uses the SAME BIP-68 metadata sequence + action-code table
//      (161 open, 163 close, 164 borrow, 165 repay, 166 deposit, 167 withdraw) as wallet-snap's
//      summary.ts. ducat-snap is a superset (also liquidate / repossess).
//   2. Multi-input P2TR signing — the repay-burn-PSBT shape (a P2TR key-path asset input alongside
//      a P2WPKH funds input) — is the exact case wallet-snap had to FIX (15d3062). ducat-snap is
//      multi-input-safe by construction (bitcoinjs-lib gathers all prevouts for the taproot sighash).
describe('wallet-snap parity', () => {
  // wallet-snap VAULT_ACTION_BY_CODE -> ducat-snap DucatVaultReturnData.actionType, by flag.
  const ACTION_PARITY: Array<{ flag: DucatVaultActionFlag; actionType: string }> = [
    { flag: 'o', actionType: 'create' }, // 161 open
    { flag: 'c', actionType: 'close' }, //  163 close
    { flag: 'b', actionType: 'borrow' }, // 164 borrow
    { flag: 'r', actionType: 'repay' }, //  165 repay
    { flag: 'd', actionType: 'deposit' }, // 166 deposit
    { flag: 'w', actionType: 'withdraw' }, // 167 withdraw
  ];

  it.each(ACTION_PARITY)('classifies the $actionType vault action from its OP_RETURN return data', ({ flag, actionType }) => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });
    const payload = vaultReturnPayload(flag, 50_000, 60_000, 123_456, 45_000);

    psbt.addInput({
      hash: '66'.repeat(32),
      index: 0,
      witnessUtxo: { script: keySet.satsOutputScript, value: 2_000_000 },
    });
    psbt.addOutput({ address: keySet.record.vault.address, value: 1_100_000 });
    psbt.addOutput({ script: btcScript.compile([opcodes.OP_RETURN, opcodes.OP_8, payload]), value: 0 });
    psbt.addOutput({ address: keySet.record.sats.address, value: 899_000 });

    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, { [keySet.record.sats.address]: [0] });

    expect(prepared.summary.vaultUpdates).toHaveLength(1);
    expect(prepared.summary.vaultUpdates[0]).toMatchObject({ actionFlag: flag, actionType });
  });

  it('signs a multi-input PSBT: a P2TR vault key-path input alongside a P2WPKH funds input (repay-burn shape)', () => {
    const keySet = makeKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    // Input 0: P2WPKH funds (sats) input.
    psbt.addInput({
      hash: '00'.repeat(32),
      index: 0,
      witnessUtxo: { script: keySet.satsOutputScript, value: 1_000_000 },
    });
    // Input 1: P2TR key-path vault input — the asset/UNIT input that, alongside input 0,
    // broke wallet-snap's @scure signer with single-element prevout arrays.
    psbt.addInput({
      hash: '11'.repeat(32),
      index: 0,
      witnessUtxo: { script: keySet.vaultOutputScript, value: 500_000 },
      tapInternalKey: keySet.vaultInternalPubkey,
    });
    psbt.addOutput({ address: keySet.record.sats.address, value: 1_400_000 });

    const signInputs = {
      [keySet.record.sats.address]: [0],
      [keySet.record.vault.address]: [1],
    };
    const prepared = preparePsbtForSigning(psbt.toBase64(), 'mutinynet', keySet, signInputs);
    const signed = Psbt.fromBase64(signPreparedPsbt(prepared.psbt, keySet, signInputs), { network: bitcoinNetwork('signet') });

    expect(signed.data.inputs[0].partialSig).toHaveLength(1); // P2WPKH funds
    expect(signed.data.inputs[1].tapKeySig).toBeDefined(); //    P2TR key-path vault

    // POSITIVE PROOF: each signature verifies against the sighash bitcoinjs-lib recomputes from the
    // FULL input set (validateSignaturesOf* gathers every prevout's script+value). This proves the
    // sighash commits to ALL inputs' prevouts — not merely that signing/finalizing did not throw.
    expect(signed.validateSignaturesOfInput(0, sigValidator)).toBe(true);
    expect(signed.validateSignaturesOfInput(1, sigValidator)).toBe(true);

    // NEGATIVE CONTROL: tamper with input 0's prevout VALUE, then re-validate input 1's taproot
    // signature. A BIP-341 key-path sighash commits to every input's amount, so a signature made
    // over the original amounts must FAIL once any prevout value is altered. If the taproot sighash
    // only covered its own input (the wallet-snap single-prevout bug), this would still pass.
    const tampered = Psbt.fromBase64(signed.toBase64(), { network: bitcoinNetwork('signet') });
    tampered.data.inputs[0].witnessUtxo!.value = 999_999;
    expect(tampered.validateSignaturesOfInput(1, sigValidator)).toBe(false);

    // The untouched, correctly-signed PSBT still finalizes cleanly.
    expect(() => signed.finalizeAllInputs()).not.toThrow();
  });
});
