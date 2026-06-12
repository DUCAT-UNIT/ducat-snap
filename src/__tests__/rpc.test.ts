import { Psbt } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { renderHomePage } from '../home';
import { bitcoinNetwork } from '../networks';
import { ALLOWED_ORIGINS, handleRpcRequest } from '../rpc';
import manifest from '../../snap.manifest.json';

const ORIGIN = 'http://localhost:3000';

type SnapRequestArgs = {
  method: string;
  params?: {
    operation?: string;
    path?: string[];
    newState?: unknown;
  };
};

function testNode(byte: number) {
  return DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
}

function testKeySet() {
  return deriveAccountSetFromBaseNodes('signet', testNode(1), testNode(2));
}

function setSnapMock(dialogResult = true) {
  let managedState: unknown = null;
  const request = jest.fn(async ({ method, params }: SnapRequestArgs) => {
    if (method === 'snap_getBip32Entropy') {
      const byte = params?.path?.[1] === "84'" ? 1 : 2;

      return {
        privateKey: Buffer.alloc(32, byte).toString('hex'),
        chainCode: Buffer.alloc(32, byte + 10).toString('hex'),
      };
    }

    if (method === 'snap_dialog') {
      return dialogResult;
    }

    if (method === 'snap_manageState') {
      if (params?.operation === 'get') {
        return managedState;
      }

      managedState = params?.newState ?? null;
      return undefined;
    }

    throw new Error(`Unexpected Snap method ${method}`);
  });

  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };

  return request;
}

function makePsbt(value: number, seed: number) {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: {
      script: keySet.satsOutputScript,
      value,
    },
  });
  psbt.addOutput({
    address: keySet.record.sats.address,
    value: value - 1_000,
  });

  return { keySet, psbt: psbt.toBase64() };
}

function makeExternalPsbt(value: number, seed: number) {
  const keySet = testKeySet();
  const external = deriveAccountSetFromBaseNodes('signet', testNode(7), testNode(8));
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: {
      script: keySet.satsOutputScript,
      value,
    },
  });
  psbt.addOutput({
    address: external.record.sats.address,
    value: value - 2_000,
  });
  psbt.addOutput({
    address: keySet.record.sats.address,
    value: 1_000,
  });

  return { keySet, psbt: psbt.toBase64() };
}

function dialogValues(request: jest.Mock): string[] {
  const dialogCall = request.mock.calls.find(([arg]) => arg.method === 'snap_dialog');

  return collectDialogText(dialogCall?.[0].params?.content);
}

function collectDialogText(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectDialogText);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as {
    children?: unknown;
    label?: unknown;
    props?: Record<string, unknown>;
    title?: unknown;
    value?: unknown;
  };
  const props = record.props ?? {};

  return [
    typeof record.value === 'string' ? record.value : null,
    typeof record.label === 'string' ? record.label : null,
    typeof record.title === 'string' ? record.title : null,
    typeof props.value === 'string' ? props.value : null,
    typeof props.label === 'string' ? props.label : null,
    typeof props.title === 'string' ? props.title : null,
    typeof props.tooltip === 'string' ? props.tooltip : null,
    ...collectDialogText(record.children),
    ...collectDialogText(props.children),
  ].filter((item): item is string => typeof item === 'string');
}

describe('RPC router', () => {
  it('rejects unknown RPC methods', async () => {
    await expect(handleRpcRequest(ORIGIN, { method: 'ducat_unknown' })).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('keeps RPC origin authorization in sync with the manifest', () => {
    const manifestOrigins = manifest.initialPermissions['endowment:rpc'].allowedOrigins;

    expect([...ALLOWED_ORIGINS].sort()).toEqual([...manifestOrigins].sort());
  });

  it('returns Snap capabilities', async () => {
    const result = await handleRpcRequest(ORIGIN, { method: 'ducat_getCapabilities' });

    expect(result).toEqual(
      expect.objectContaining({
        snap: '@ducat-unit/ducat-snap',
        networks: ['signet', 'mutinynet'],
        methods: expect.arrayContaining(['ducat_clearRecentActions']),
        features: expect.objectContaining({
          mainnet: false,
          psbtSigning: true,
        }),
      }),
    );
  });

  it('rejects unauthorized origins before requesting entropy', async () => {
    const request = setSnapMock();

    await expect(handleRpcRequest('https://evil.example', { method: 'ducat_getAccounts', params: { network: 'signet' } })).rejects.toMatchObject({
      code: 'ORIGIN_NOT_AUTHORIZED',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('confirms and clears recent actions through RPC', async () => {
    const request = setSnapMock();

    const result = await handleRpcRequest(ORIGIN, { method: 'ducat_clearRecentActions' });
    const dialogText = dialogValues(request).join('\n');
    const stateUpdate = request.mock.calls.find(
      ([arg]) => arg.method === 'snap_manageState' && arg.params?.operation === 'update',
    )?.[0].params?.newState;

    expect(result).toEqual({ cleared: true });
    expect(dialogText).toContain('Clear recent actions');
    expect(stateUpdate).toEqual({ recentActions: [] });
  });

  it('returns derived Ducat account records', async () => {
    setSnapMock();

    const accounts = await handleRpcRequest(ORIGIN, {
      method: 'ducat_getAccounts',
      params: { network: 'signet' },
    });

    expect(accounts).toEqual(
      expect.objectContaining({
        sats: expect.objectContaining({ address: expect.stringMatching(/^tb1q/), pubkey: expect.stringMatching(/^[0-9a-f]{66}$/) }),
        runes: expect.objectContaining({ address: expect.stringMatching(/^tb1p/), pubkey: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        vault: expect.objectContaining({ address: expect.stringMatching(/^tb1p/), pubkey: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        authCandidates: expect.any(Array),
      }),
    );
  });

  it('rejects unsupported networks before requesting entropy', async () => {
    const request = setSnapMock();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_getAccounts',
        params: { network: 'mainnet' },
      }),
    ).rejects.toThrow('supports signet and mutinynet only');
    expect(request).not.toHaveBeenCalled();
  });

  it('validates signPsbt params before requesting entropy', async () => {
    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt: null, signInputs: {} },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('rejects message signing for unknown addresses', async () => {
    const request = setSnapMock();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signMessage',
        params: { network: 'signet', address: 'tb1qunknown', message: 'hello' },
      }),
    ).rejects.toThrow('not managed by the Ducat Snap');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('renders arbitrary message signing content as copyable confirmation data', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();
    const message = 'Sign in to Ducat with **literal markdown** and [link text](https://example.com)';

    const result = await handleRpcRequest(ORIGIN, {
      method: 'ducat_signMessage',
      params: { network: 'signet', address: keySet.record.sats.address, message },
    });
    const rendered = dialogValues(request).join('\n');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        result: expect.objectContaining({
          address: keySet.record.sats.address,
          protocol: 'BIP322',
          signature: expect.any(String),
        }),
      }),
    );
    expect(rendered).toContain('Message signing');
    expect(rendered).toContain('BIP322 simple');
    expect(rendered).toContain(message);
  });

  it('rejects malformed PSBTs', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt: 'not-a-psbt', signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'MALFORMED_PSBT' });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects PSBT signing when the confirmation is declined', async () => {
    setSnapMock(false);
    const { keySet, psbt } = makePsbt(100_000, 3);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'USER_REJECTED' });
  });

  it('renders Ducat action labels, parsed output facts, and app metadata in PSBT confirmations', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makeExternalPsbt(100_000, 9);

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: {
        network: 'signet',
        psbt,
        signInputs: { [keySet.record.sats.address]: [0] },
        context: {
          actionType: 'deposit',
          metadata: {
            vault_id: 'vault-alpha',
          },
        },
      },
    });

    const rendered = dialogValues(request).join('\n');

    expect(rendered).toContain('Deposit BTC');
    expect(rendered).toContain('At a glance');
    expect(rendered).toContain('Net spend');
    expect(rendered).toContain('Recipients');
    expect(rendered).toContain('Security check');
    expect(rendered).toContain('Ducat app context');
    expect(rendered).toContain('Vault Id');
    expect(rendered).toContain('App labels are shown for context.');
  });

  it('rejects unknown PSBT input indexes before showing confirmation', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makePsbt(100_000, 6);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [1] } },
      }),
    ).rejects.toMatchObject({
      code: 'PSBT_INPUT_INDEX_INVALID',
      details: expect.objectContaining({ inputIndex: 1 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('batch signing preserves PSBT order', async () => {
    setSnapMock();
    const first = makePsbt(100_000, 4);
    const second = makePsbt(200_000, 5);

    const result = (await handleRpcRequest(ORIGIN, {
      method: 'ducat_signBatch',
      params: {
        network: 'signet',
        entries: [
          { psbt: first.psbt, signInputs: { [first.keySet.record.sats.address]: [0] } },
          { psbt: second.psbt, signInputs: { [second.keySet.record.sats.address]: [0] } },
        ],
      },
    })) as { psbts: string[] };

    expect(result.psbts).toHaveLength(2);
    expect(Psbt.fromBase64(result.psbts[0], { network: bitcoinNetwork('signet') }).txOutputs[0].value).toBe(99_000);
    expect(Psbt.fromBase64(result.psbts[1], { network: bitcoinNetwork('signet') }).txOutputs[0].value).toBe(199_000);
  });

  it('batch signing rejects the whole batch before confirmation when one entry is invalid', async () => {
    const request = setSnapMock();
    const first = makePsbt(100_000, 7);
    const second = makePsbt(200_000, 8);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signBatch',
        params: {
          network: 'signet',
          entries: [
            { psbt: first.psbt, signInputs: { [first.keySet.record.sats.address]: [0] } },
            { psbt: second.psbt, signInputs: { [second.keySet.record.sats.address]: [1] } },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: 'PSBT_INPUT_INDEX_INVALID',
      details: expect.objectContaining({ inputIndex: 1 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('renders Snap Home from the last connected network and origin', async () => {
    setSnapMock();
    const fetchMock = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);

      if (href.includes('/address/')) {
        return new Response(
          JSON.stringify({
            chain_stats: { funded_txo_sum: 50_000, spent_txo_sum: 10_000 },
            mempool_stats: { funded_txo_sum: 5_000, spent_txo_sum: 0 },
          }),
          { status: 200 },
        );
      }

      if (href.includes('/api/unit_utxos_by_address')) {
        return new Response(JSON.stringify({ outputs: [{ spent: false, unit_amount: 12345 }] }), { status: 200 });
      }

      if (href.includes('/api/vault_list')) {
        return new Response(
          JSON.stringify({
            vaults: [
              {
                btc_locked: 0.5,
                collateral_ratio: 250,
                liquidation_price: 40_000,
                oracle_price: 100_000,
                unit_borrowed: 1_000,
                vault_id: 'vault-1',
                vault_last_action: 'active',
                vault_tag: 'Alpha vault',
              },
            ],
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected fetch ${href} ${init?.method ?? 'GET'}`);
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await handleRpcRequest('http://localhost:3002', {
        method: 'ducat_getAccounts',
        params: { network: 'signet' },
      });

      const home = await renderHomePage();
      const rendered = JSON.stringify(home.content);

      expect(rendered).toContain('Signet testnet');
      expect(rendered).toContain('http://localhost:3002/?action=deposit');
      expect(rendered).not.toContain('[Deposit](http://localhost:3002/?action=deposit)');
      expect(rendered).toContain('Alpha vault');
      expect(rendered).toContain('45,000 sats');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
