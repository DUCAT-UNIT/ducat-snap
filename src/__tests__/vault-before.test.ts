import { Buffer } from 'buffer';
import { opcodes, Psbt, script, Transaction } from 'bitcoinjs-lib';
import { previousVaultState } from '../psbt';
import { PsbtVerificationContext } from '../psbt-verification';
import type { WalletInventoryResponse } from '../types';
import { depositPreview } from './helpers/deposit-preview';

const { keys } = depositPreview();
const collateral = 10_827_400;
const profile = {
  id: 'mutinynet' as const, label: 'Testnet', bitcoin_network: 'signet' as const,
  expected_validator_chain_network: 'mutiny', validator_base_url: 'https://validator.example',
  esplora_base_url: 'https://esplora.example',
};

function legacyData() {
  const payload = Buffer.alloc(38);
  payload[0] = 1;
  payload[1] = 'd'.charCodeAt(0);
  payload.writeUInt32BE(135_000, 2);
  payload.writeUInt32BE(100_000, 6);
  payload.writeUInt32BE(1_793_318_300, 10);
  payload.writeUInt32BE(18_703, 14);
  return script.compile([opcodes.OP_RETURN, opcodes.OP_8, payload]);
}

function parent() {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 8), 0);
  tx.addOutput(keys.vaultOutputScript, collateral);
  tx.addOutput(legacyData(), 0);
  return tx;
}

function view(tx: Transaction) {
  return { txInputs: tx.ins, txOutputs: tx.outs };
}

function inventory(): WalletInventoryResponse {
  return {
    network: 'mutinynet', account: keys.record, assetId: '123:45', observedAt: 1, expiresAt: 30_001,
    btcUtxos: [], unitUtxos: [],
    balances: { btcSats: '0', btcUtxos: 0, unitActive: '0', unitReserved: '0', unitMixedActive: '0', unitMixedReserved: '0' },
  };
}

function child(tx: Transaction, vout = 0) {
  const psbt = new Psbt();
  psbt.addInput({ hash: tx.getId(), index: vout, witnessUtxo: tx.outs[vout] });
  psbt.addOutput({ script: keys.vaultOutputScript, value: collateral - 500 });
  const summary = depositPreview().summary;
  summary.inputCount = 1;
  summary.signedInputIndexes = [0];
  summary.signedInputs = [{ ...summary.signedInputs[1], index: 0 }];
  return { psbt, summary };
}

function esplora(tx: Transaction, override: Record<string, unknown> = {}) {
  return jest.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(
    String(url).includes('/outspend/') ? { spent: false } : {
      txid: tx.getId(), vin: tx.ins.map(({ sequence }) => ({ sequence })),
      vout: tx.outs.map(({ value, script: outputScript }) => ({ value, scriptpubkey: outputScript.toString('hex') })),
      ...override,
    },
  ))) as jest.MockedFunction<typeof fetch>;
}

it('binds a decoded prior state to the exact spent collateral output and account', () => {
  const tx = parent();
  tx.addOutput(keys.vaultOutputScript, collateral);
  expect(previousVaultState(view(tx), 0, 'mutinynet', keys.record)).toMatchObject({
    collateralSats: collateral, unitBalanceUnit: 1350, tholdPrice: 18703,
  });
  expect(previousVaultState(view(tx), 2, 'mutinynet', keys.record)).toBeUndefined();
  expect(previousVaultState(view(tx), 0, 'mutinynet', {
    ...keys.record, vault: keys.record.sats,
  })).toBeUndefined();
  tx.addOutput(legacyData(), 0);
  expect(previousVaultState(view(tx), 0, 'mutinynet', keys.record)).toBeUndefined();
});

it('also decodes the core sequence format at its action-specific output index', () => {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 9), 0, (0xc0000000 | (164 << 8) | 1) >>> 0);
  tx.addOutput(keys.satsOutputScript, 546);
  tx.addOutput(keys.vaultOutputScript, collateral);
  const payload = Buffer.alloc(105);
  payload[0] = 1; payload[1] = 1; payload[2] = 0;
  payload.writeUInt32BE(135_000, 3);
  payload.writeUInt32BE(1_793_318_300, 7);
  payload[11] = 1;
  payload.writeUInt32BE(100_000, 13);
  payload.writeUInt32BE(18_703, 17);
  tx.addOutput(script.compile([opcodes.OP_RETURN, opcodes.OP_8, payload]), 0);
  expect(previousVaultState(view(tx), 1, 'mutinynet', keys.record)).toMatchObject({
    actionType: 'borrow', collateralSats: collateral, unitBalanceUnit: 1350, tholdPrice: 18703,
  });
  expect(previousVaultState(view(tx), 0, 'mutinynet', keys.record)).toBeUndefined();
});

it('attaches prior debt from the existing trusted Esplora read without extra requests', async () => {
  const tx = parent();
  const { psbt, summary } = child(tx);
  summary.vaultBefore!.debtUnit = 99_999;
  const fetchImpl = esplora(tx);
  await new PsbtVerificationContext('mutinynet', { profile, inventory: inventory(), fetchImpl }).verify(psbt, summary);
  expect(summary.vaultBefore).toEqual({
    inputIndex: 0,
    collateralSats: collateral,
    debtUnit: 1350,
    liquidationPrice: 18703,
    unitPrice: 100_000,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it.each([undefined, [{ sequence: -1 }]])('leaves missing/malformed prior metadata unknown while retaining prevout verification', async (vin) => {
  const tx = parent();
  const { psbt, summary } = child(tx);
  const fetchImpl = esplora(tx, { vin });
  await new PsbtVerificationContext('mutinynet', { profile, inventory: inventory(), fetchImpl }).verify(psbt, summary);
  expect(summary.vaultBefore).toBeUndefined();
  psbt.data.inputs[0].witnessUtxo!.value++;
  await expect(new PsbtVerificationContext('mutinynet', { profile, inventory: inventory(), fetchImpl }).verify(psbt, summary))
    .rejects.toMatchObject({ code: 'WALLET_DATA_MISMATCH' });
});

it.each([false, true])('uses supplied raw prior data only when its transaction hash matches (%s tampered)', async (tampered) => {
  const tx = parent();
  const { psbt, summary } = child(tx);
  const wallet = inventory();
  wallet.btcUtxos.push({ txid: tx.getId(), vout: 0, valueSats: collateral, scriptPubKey: keys.vaultOutputScript.toString('hex') });
  if (tampered) tx.locktime++;
  psbt.data.inputs[0].nonWitnessUtxo = tx.toBuffer();
  const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
  await new PsbtVerificationContext('mutinynet', { profile, inventory: wallet, fetchImpl }).verify(psbt, summary);
  expect(summary.vaultBefore?.debtUnit).toBe(tampered ? undefined : 1350);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('uses the previous verified batch transaction for a later vault spend', async () => {
  const tx = parent();
  const batchParent = new Psbt();
  batchParent.addInput({ hash: 'ab'.repeat(32), index: 0, witnessUtxo: { script: keys.satsOutputScript, value: collateral + 500 } });
  for (const output of tx.outs) batchParent.addOutput(output);
  const unsigned = Transaction.fromBuffer(batchParent.data.globalMap.unsignedTx.toBuffer());
  const { psbt, summary } = child(unsigned);
  const wallet = inventory();
  wallet.btcUtxos.push({ txid: 'ab'.repeat(32), vout: 0, valueSats: collateral + 500, scriptPubKey: keys.satsOutputScript.toString('hex') });
  const fetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;
  const verifier = new PsbtVerificationContext('mutinynet', { profile, inventory: wallet, fetchImpl });
  const parentSummary = depositPreview().funding;
  await verifier.verify(batchParent, parentSummary);
  await verifier.verify(psbt, summary);
  expect(summary.vaultBefore?.debtUnit).toBe(1350);
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('does not combine debt from multiple spent vault outputs', async () => {
  const first = parent();
  const second = parent(); second.locktime++;
  const { psbt, summary } = child(first);
  psbt.addInput({ hash: second.getId(), index: 0, witnessUtxo: second.outs[0] });
  psbt.data.inputs[0].nonWitnessUtxo = first.toBuffer();
  psbt.data.inputs[1].nonWitnessUtxo = second.toBuffer();
  summary.signedInputs.push({ ...summary.signedInputs[0], index: 1 });
  const wallet = inventory();
  wallet.btcUtxos = [first, second].map((tx) => ({ txid: tx.getId(), vout: 0, valueSats: collateral, scriptPubKey: keys.vaultOutputScript.toString('hex') }));
  await new PsbtVerificationContext('mutinynet', { profile, inventory: wallet, fetchImpl: jest.fn() }).verify(psbt, summary);
  expect(summary.vaultBefore).toBeUndefined();
});
