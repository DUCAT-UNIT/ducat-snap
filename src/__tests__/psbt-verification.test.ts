import { Psbt, Transaction } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { PsbtVerificationContext, canonicalTxid } from '../psbt-verification';
import type { PsbtSummary, WalletInventoryResponse } from '../types';

const TXID = '12'.repeat(32);
const SCRIPT = '0014' + '34'.repeat(20);

function inventory(): WalletInventoryResponse {
  const account = {
    sats: { address: 'tb1qsats', pubkey: '02' + '11'.repeat(32) },
    runes: { address: 'tb1prunes', pubkey: '22'.repeat(32) },
    vault: { address: 'tb1pvault', pubkey: '33'.repeat(32) },
    authCandidates: [],
  };
  return {
    network: 'mutinynet', observedAt: 1, expiresAt: 30_001, assetId: '123:45', account,
    balances: { btcSats: '0', btcUtxos: 0, unitActive: '9', unitReserved: '0', unitMixedActive: '0', unitMixedReserved: '0' },
    btcUtxos: [],
    unitUtxos: [{
      txid: TXID, vout: 2, coinId: `${TXID}:2`, coinValueSats: 546,
      scriptPubKey: SCRIPT, assetId: '123:45', activeAmount: '9', reservedAmount: '0', classification: 'active',
    }],
  };
}

function psbt(value = 546, txid = TXID, vout = 2): Psbt {
  return {
    txInputs: [{ hash: Buffer.from(txid, 'hex').reverse(), index: vout }],
    data: { inputs: [{ witnessUtxo: { value, script: Buffer.from(SCRIPT, 'hex') } }] },
  } as unknown as Psbt;
}

function summary(): PsbtSummary {
  return { unitInputs: [] } as unknown as PsbtSummary;
}

function context(fetchImpl: typeof fetch = jest.fn() as unknown as typeof fetch) {
  return new PsbtVerificationContext('mutinynet', {
    fetchImpl,
    inventory: inventory(),
    profile: { id: 'mutinynet', label: 'Mutinynet', bitcoin_network: 'signet', expected_validator_chain_network: 'mutiny', validator_base_url: 'https://validator.example', esplora_base_url: 'https://esplora.example' },
  });
}

describe('PSBT chain-truth verification', () => {
  it('converts bitcoinjs input hashes to canonical display txids', () => {
    expect(canonicalTxid(Buffer.from(TXID, 'hex').reverse())).toBe(TXID);
  });

  it('matches UNIT inputs against the wallet snapshot and attaches textual evidence', async () => {
    const evidence = summary();
    await context().verify(psbt(), evidence);
    expect(evidence.unitInputs).toEqual([{
      outpoint: `${TXID}:2`, coinId: `${TXID}:2`, assetId: '123:45',
      activeAmount: '9', reservedAmount: '0', classification: 'active',
    }]);
  });

  it('rejects a forged witness value before confirmation', async () => {
    await expect(context().verify(psbt(547), summary())).rejects.toMatchObject({ code: 'WALLET_DATA_MISMATCH' });
  });

  it('deduplicates trusted Esplora prevout and spend-status reads', async () => {
    const externalTxid = 'ab'.repeat(32);
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/outspend/1')) return new Response(JSON.stringify({ spent: false }), { status: 200 });
      return new Response(JSON.stringify({ txid: externalTxid, vout: [null, { value: 546, scriptpubkey: SCRIPT }] }), { status: 200 });
    }) as jest.MockedFunction<typeof fetch>;
    const verifier = context(fetchImpl);
    await Promise.all([verifier.verify(psbt(546, externalTxid, 1), summary()), verifier.verify(psbt(546, externalTxid, 1), summary())]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('trusts a verified earlier batch output without reading an unbroadcast tx from Esplora', async () => {
    const parent = new Psbt();
    parent.addInput({
      hash: TXID,
      index: 2,
      witnessUtxo: { value: 546, script: Buffer.from(SCRIPT, 'hex') },
    });
    parent.addOutput({ value: 500, script: Buffer.from(SCRIPT, 'hex') });
    const parentTxid = Transaction.fromBuffer(
      parent.data.globalMap.unsignedTx.toBuffer(),
    ).getId();
    const child = psbt(500, parentTxid, 0);
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const verifier = context(fetchImpl);

    await verifier.verify(parent, summary());
    await verifier.verify(child, summary());

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects spent targeted prevouts', async () => {
    const externalTxid = 'cd'.repeat(32);
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.endsWith('/outspend/1')
        ? new Response(JSON.stringify({ spent: true }), { status: 200 })
        : new Response(JSON.stringify({ txid: externalTxid, vout: [null, { value: 546, scriptpubkey: SCRIPT }] }), { status: 200 });
    }) as jest.MockedFunction<typeof fetch>;
    await expect(context(fetchImpl).verify(psbt(546, externalTxid, 1), summary())).rejects.toMatchObject({ code: 'WALLET_DATA_MISMATCH' });
  });
});
