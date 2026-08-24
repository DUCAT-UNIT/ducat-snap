import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import type { SelectedAccountKeySet } from '../key-overrides';
import { WalletInventoryService } from '../wallet-inventory';

const UNIT_ASSET_ID = '123:45';

function node(byte: number) {
  return DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
}

function account(): SelectedAccountKeySet {
  return {
    ...deriveAccountSetFromBaseNodes('signet', node(1), node(2)),
    id: 'derived:signet:0',
    source: 'derived',
    network: 'signet',
  };
}

function protoLatest() {
  const term = (key: number, value: unknown) => ({ group: 63, key, value: [value] });
  return {
    proto_terms: [
      term(241, 0.1), term(242, 1.5), term(243, '11'.repeat(32)), term(244, 546),
      term(245, 0.01), term(246, 1.1), term(247, UNIT_ASSET_ID), term(248, 1),
      term(249, 1.5), term(250, 10_000),
    ],
  };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function fixture(now: () => number) {
  const active = account();
  const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/proto/latest')) return response(protoLatest());
    if (url.includes('/address/') && url.endsWith('/utxo')) {
      return response([{ txid: 'a'.repeat(64), vout: 1, value: 25_000 }]);
    }
    if (url.includes('/api/address/')) {
      return response({ data: [
        {
          asset_id: UNIT_ASSET_ID,
          asset_balance: '900719925474099312345',
          asset_reserve: '0',
          coin_id: `${'b'.repeat(64)}:0`,
          coin_script: active.runesOutputScript.toString('hex'),
          coin_value: 546,
        },
        {
          asset_id: UNIT_ASSET_ID,
          asset_balance: '7',
          asset_reserve: '8',
          coin_id: `${'c'.repeat(64)}:2`,
          coin_script: active.runesOutputScript.toString('hex'),
          coin_value: 546,
        },
      ] });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as jest.MockedFunction<typeof fetch>;
  const service = new WalletInventoryService({
    fetchImpl,
    now,
    resolveAccount: async () => active,
    resolveProfile: async () => ({
      id: 'signet',
      label: 'Signet',
      bitcoin_network: 'signet',
      validator_base_url: 'https://validator.example',
      esplora_base_url: 'https://esplora.example',
    }),
    verifyEndpoint: async () => undefined,
  });
  return { active, fetchImpl, service };
}

describe('WalletInventoryService', () => {
  it('returns the exact singular wallet snapshot and preserves decimal UNIT totals', async () => {
    const { active, service } = fixture(() => 1_000);
    const inventory = await service.get('signet');
    expect(inventory).toEqual({
      network: 'signet',
      observedAt: 1_000,
      expiresAt: 31_000,
      assetId: UNIT_ASSET_ID,
      account: active.record,
      balances: {
        btcSats: '25000',
        btcUtxos: 1,
        unitActive: '900719925474099312345',
        unitReserved: '0',
        unitMixedActive: '7',
        unitMixedReserved: '8',
      },
      btcUtxos: [{
        txid: 'a'.repeat(64), vout: 1, valueSats: 25_000,
        scriptPubKey: active.satsOutputScript.toString('hex'),
      }],
      unitUtxos: expect.arrayContaining([
        expect.objectContaining({ classification: 'active', activeAmount: '900719925474099312345' }),
        expect.objectContaining({ classification: 'mixed', activeAmount: '7', reservedAmount: '8' }),
      ]),
    });
    expect(JSON.stringify(inventory)).not.toMatch(/accountId|source|endpoint|private/iu);
  });

  it('deduplicates concurrent refreshes, caches for 30 seconds, and never serves expired data', async () => {
    let time = 1_000;
    const { fetchImpl, service } = fixture(() => time);
    const [first, parallel] = await Promise.all([service.get('signet'), service.get('signet')]);
    expect(first).toBe(parallel);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    time = 30_999;
    expect(await service.get('signet')).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    time = 31_000;
    expect(await service.get('signet')).not.toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('invalidates a network snapshot explicitly', async () => {
    const { fetchImpl, service } = fixture(() => 1_000);
    await service.get('signet');
    service.invalidate('signet');
    await service.get('signet');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('sanitizes endpoint failures', async () => {
    const active = account();
    const service = new WalletInventoryService({
      fetchImpl: jest.fn(async () => { throw new Error('secret https://bad.example/token'); }) as unknown as typeof fetch,
      resolveAccount: async () => active,
      resolveProfile: async () => ({
        id: 'signet', label: 'Signet', bitcoin_network: 'signet', validator_base_url: 'https://bad.example', esplora_base_url: 'https://bad.example',
      }),
      verifyEndpoint: async () => { throw new Error('secret https://bad.example/token'); },
    });
    await expect(service.get('signet')).rejects.toMatchObject({
      code: 'WALLET_DATA_UNAVAILABLE',
      message: 'Wallet data is temporarily unavailable.',
    });
    await expect(service.get('signet')).rejects.not.toThrow(/bad\.example|secret|token/iu);
  });
});
