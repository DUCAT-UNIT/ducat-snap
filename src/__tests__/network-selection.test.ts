import { Buffer } from 'buffer';

import { handleRpcRequest } from '../rpc';
import type { DeploymentId, DucatSnapState } from '../types';

const ORIGIN = 'https://app.ducatprotocol.com';

type MockOptions = {
  dialogResult?: boolean;
  failUpdate?: boolean;
  selectedNetwork?: DeploymentId;
};

type SnapRequestArgs = {
  method: string;
  params?: {
    content?: unknown;
    newState?: DucatSnapState;
    operation?: string;
    path?: string[];
  };
};

function setSnapMock(options: MockOptions = {}) {
  let state: DucatSnapState = {
    recentActions: [],
    selectedNetwork: options.selectedNetwork ?? 'mutinynet',
  };
  const request = jest.fn(async ({ method, params }: SnapRequestArgs) => {
    if (method === 'snap_manageState') {
      if (params?.operation === 'get') return state;
      if (options.failUpdate) throw new Error('state update failed');
      state = params?.newState ?? state;
      return undefined;
    }
    if (method === 'snap_dialog') return options.dialogResult ?? true;
    if (method === 'snap_getBip32Entropy') {
      return {
        privateKey: Buffer.alloc(32, 1).toString('hex'),
        chainCode: Buffer.alloc(32, 2).toString('hex'),
      };
    }
    if (method === 'snap_notify') return undefined;
    throw new Error(`Unexpected Snap method ${method}`);
  });
  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };
  return { request, state: () => state };
}

function dialogText(request: jest.Mock): string {
  const call = request.mock.calls.find(([args]) => args.method === 'snap_dialog');
  return JSON.stringify(call?.[0]?.params?.content ?? '');
}

describe('explicit Snap network selection', () => {
  it('returns the selected network without side effects', async () => {
    const { request } = setSnapMock({ selectedNetwork: 'signet' });

    await expect(handleRpcRequest(ORIGIN, { method: 'ducat_getNetwork' })).resolves.toEqual({
      network: 'signet',
      label: 'signet',
    });
    expect(request.mock.calls.map(([args]) => args.method)).toEqual(['snap_manageState']);
  });

  it('returns a same-network switch as a confirmation-free no-op', async () => {
    const { request, state } = setSnapMock({ selectedNetwork: 'signet' });

    await expect(handleRpcRequest(ORIGIN, {
      method: 'ducat_switchNetwork',
      params: { network: 'signet' },
    })).resolves.toEqual({ network: 'signet', changed: false });
    expect(state().selectedNetwork).toBe('signet');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('persists an approved switch after showing Snap-owned network facts', async () => {
    const { request, state } = setSnapMock({ selectedNetwork: 'mutinynet' });

    await expect(handleRpcRequest(ORIGIN, {
      method: 'ducat_switchNetwork',
      params: { network: 'testnet4' },
    })).resolves.toEqual({ network: 'testnet4', changed: true });

    expect(state().selectedNetwork).toBe('testnet4');
    expect(dialogText(request)).toContain('Switch Ducat network');
    expect(dialogText(request)).toContain(ORIGIN);
    expect(dialogText(request)).toContain('mutinynet');
    expect(dialogText(request)).toContain('testnet4');
    expect(dialogText(request)).toContain('https://validator-testnet4.dev.ducatprotocol.com');
    expect(dialogText(request)).toContain('https://mempool.space');
    expect(dialogText(request)).toContain('signing context');
  });

  it('leaves selection unchanged when the switch is rejected', async () => {
    const { request, state } = setSnapMock({ dialogResult: false, selectedNetwork: 'mutinynet' });

    await expect(handleRpcRequest(ORIGIN, {
      method: 'ducat_switchNetwork',
      params: { network: 'signet' },
    })).rejects.toMatchObject({ code: 'USER_REJECTED' });
    expect(state().selectedNetwork).toBe('mutinynet');
    expect(request.mock.calls.filter(([args]) => args.params?.operation === 'update')).toHaveLength(0);
  });

  it.each([
    undefined,
    null,
    {},
    { network: 'unknown' },
    { network: 'signet', validator_base_url: 'https://attacker.example' },
  ])('rejects invalid or over-broad switch parameters: %p', async (params) => {
    const { request } = setSnapMock();

    await expect(handleRpcRequest(ORIGIN, {
      method: 'ducat_switchNetwork',
      params,
    })).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_(?:NETWORK|PARAMS)/u) });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('shows the stronger real-BTC warning for mainnet', async () => {
    const { request } = setSnapMock({ dialogResult: false });

    await expect(handleRpcRequest(ORIGIN, {
      method: 'ducat_switchNetwork',
      params: { network: 'mainnet' },
    })).rejects.toMatchObject({ code: 'USER_REJECTED' });
    expect(dialogText(request)).toContain('Real BTC warning');
    expect(dialogText(request)).toContain('Real BTC may be spent');
    expect(dialogText(request)).toContain('danger');
  });

  it('keeps the prior selection effective when persistence fails', async () => {
    const { state } = setSnapMock({ failUpdate: true, selectedNetwork: 'mutinynet' });

    await expect(handleRpcRequest(ORIGIN, {
      method: 'ducat_switchNetwork',
      params: { network: 'signet' },
    })).rejects.toThrow('state update failed');
    expect(state().selectedNetwork).toBe('mutinynet');
  });

  it.each([
    'ducat_getAccounts',
    'ducat_getWalletInventory',
    'ducat_signMessage',
    'ducat_signPsbt',
    'ducat_signBatch',
  ])('rejects %s before entropy, network, notification, dialog, or state-write side effects', async (method) => {
    const { request, state } = setSnapMock({ selectedNetwork: 'mutinynet' });
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await expect(handleRpcRequest(ORIGIN, {
        method,
        params: { network: 'signet' },
      })).rejects.toMatchObject({
        code: 'NETWORK_MISMATCH',
        details: { selectedNetwork: 'mutinynet', requestedNetwork: 'signet' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(state().selectedNetwork).toBe('mutinynet');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(request.mock.calls.map(([args]) => args.method)).toEqual(['snap_manageState']);
  });
});
