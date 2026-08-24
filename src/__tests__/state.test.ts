import { appendRecentAction, clearRecentActions, getState, rememberDucatSession } from '../state';
import type { DucatSnapState, PrivateKeyOverrideRecord } from '../types';

type SnapRequestArgs = {
  method: string;
  params?: {
    operation?: string;
    newState?: DucatSnapState;
  };
};

function setStateMock(initialState: unknown = null) {
  let managedState = initialState;
  const request = jest.fn(async ({ method, params }: SnapRequestArgs) => {
    if (method !== 'snap_manageState') {
      throw new Error(`Unexpected Snap method ${method}`);
    }

    if (params?.operation === 'get') {
      return managedState;
    }

    managedState = params?.newState ?? null;
    return undefined;
  });

  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };

  return {
    request,
    getStoredState: () => managedState,
  };
}

function loadAlphaState(): typeof import('../state') {
  const previous = {
    policy: process.env.DUCAT_SNAP_ARTIFACT_POLICY,
    origin: process.env.DUCAT_SNAP_ALPHA_ORIGIN,
  };
  process.env.DUCAT_SNAP_ARTIFACT_POLICY = 'alpha-mainnet';
  process.env.DUCAT_SNAP_ALPHA_ORIGIN = 'http://localhost:8075';
  jest.resetModules();
  jest.doMock('../artifact-policy', () => require('../artifact-policy.alpha'));
  const module = require('../state') as typeof import('../state');
  if (previous.policy === undefined) delete process.env.DUCAT_SNAP_ARTIFACT_POLICY;
  else process.env.DUCAT_SNAP_ARTIFACT_POLICY = previous.policy;
  if (previous.origin === undefined) delete process.env.DUCAT_SNAP_ALPHA_ORIGIN;
  else process.env.DUCAT_SNAP_ALPHA_ORIGIN = previous.origin;
  jest.resetModules();
  jest.dontMock('../artifact-policy');
  return module;
}

const keyOverride: PrivateKeyOverrideRecord = {
  id: 'imported-signet-1',
  source: 'imported',
  network: 'signet',
  created_at: 1_700_000_000,
  fingerprint: 'fp-1',
  private_key: '11'.repeat(32),
  sats: {
    address: 'tb1qexample',
    pubkey: `02${'11'.repeat(32)}`,
  },
  runes: {
    address: 'tb1pexample',
    pubkey: '22'.repeat(32),
  },
};

describe('Snap state', () => {
  it('defaults an empty store to Mutinynet without eagerly writing state', async () => {
    const { request } = setStateMock(null);

    await expect(getState()).resolves.toEqual({ recentActions: [], selectedNetwork: 'mutinynet' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('migrates a valid legacy selection once and removes the legacy field', async () => {
    const { request, getStoredState } = setStateMock({
      recentActions: [],
      lastNetwork: 'signet',
      lastOrigin: 'https://app.ducatprotocol.com',
      keyOverrides: [keyOverride],
      networkEndpointOverrides: {
        signet: {
          validator_base_url: 'https://validator-override.example',
          network_identity_verified: true,
        },
      },
    });

    const first = await getState();
    const second = await getState();

    expect(first.selectedNetwork).toBe('signet');
    expect(second).toEqual(first);
    expect(first.keyOverrides).toEqual([keyOverride]);
    expect(first.lastOrigin).toBe('https://app.ducatprotocol.com');
    expect(first.networkEndpointOverrides?.signet?.validator_base_url).toBe('https://validator-override.example');
    expect(getStoredState()).not.toHaveProperty('lastNetwork');
    expect(request.mock.calls.filter(([args]) => args.params?.operation === 'update')).toHaveLength(1);
  });

  it('prefers a valid explicit selection over conflicting legacy state', async () => {
    const { getStoredState } = setStateMock({
      recentActions: [],
      selectedNetwork: 'signet',
      lastNetwork: 'mainnet',
    });

    const state = await getState();

    expect(state.selectedNetwork).toBe('signet');
    expect(getStoredState()).toEqual({ recentActions: [], selectedNetwork: 'signet' });
  });

  it('preserves a recognized deployment selection in the production artifact', async () => {
    const { getStoredState } = setStateMock({
      recentActions: [],
      selectedNetwork: 'alpha-mainnet',
    });

    await expect(getState()).resolves.toMatchObject({
      recentActions: [],
      selectedNetwork: 'alpha-mainnet',
    });
    expect(getStoredState()).toMatchObject({ recentActions: [], selectedNetwork: 'alpha-mainnet' });
  });

  it('defaults and repairs persisted selection to alpha-mainnet in the alpha artifact', async () => {
    const alphaState = loadAlphaState();
    const { getStoredState } = setStateMock({
      recentActions: [],
      selectedNetwork: 'mutinynet',
    });

    await expect(alphaState.getState()).resolves.toMatchObject({
      recentActions: [],
      selectedNetwork: 'alpha-mainnet',
    });
    expect(getStoredState()).toMatchObject({ recentActions: [], selectedNetwork: 'alpha-mainnet' });
  });

  it('defaults corrupt explicit and legacy selections to Mutinynet', async () => {
    const { getStoredState } = setStateMock({ recentActions: [], selectedNetwork: 'bad', lastNetwork: 'also-bad' });

    await expect(getState()).resolves.toEqual({ recentActions: [], selectedNetwork: 'mutinynet' });
    expect(getStoredState()).toEqual({ recentActions: [], selectedNetwork: 'mutinynet' });
  });

  it('filters corrupt actions, sorts newest first, caps history, and preserves session metadata', async () => {
    const validActions = Array.from({ length: 14 }, (_, index) => ({
      id: `valid-${index}`,
      actionType: 'deposit',
      network: index % 2 === 0 ? 'signet' : 'mutinynet',
      origin: 'http://localhost:3002',
      timestamp: 1_000 + index,
      status: 'signed',
    }));
    setStateMock({
      recentActions: [
        { id: 'bad-network', actionType: 'deposit', network: 'regtest', origin: 'http://localhost:3002', timestamp: 999 },
        { id: 'bad-details', actionType: 'deposit', network: 'signet', origin: 'http://localhost:3002', timestamp: 999, details: [] },
        ...validActions,
      ],
      selectedNetwork: 'signet',
      lastOrigin: 'http://localhost:3002',
    });

    const state = await getState();

    expect(state.recentActions).toHaveLength(12);
    expect(state.recentActions[0]?.id).toBe('valid-13');
    expect(state.recentActions.at(-1)?.id).toBe('valid-2');
    expect(state.selectedNetwork).toBe('signet');
    expect(state.lastOrigin).toBe('http://localhost:3002');
  });

  it('appends actions with default signed status without changing selection', async () => {
    const { getStoredState } = setStateMock({
      recentActions: [],
      selectedNetwork: 'mutinynet',
      lastOrigin: 'https://app.ducatprotocol.com',
    });

    await appendRecentAction({
      actionType: 'borrow',
      title: 'Borrow UNIT',
      network: 'signet',
      origin: 'http://localhost:3002',
      summary: 'Borrowed UNIT',
    });

    const storedState = getStoredState() as DucatSnapState;

    expect(storedState.recentActions).toHaveLength(1);
    expect(storedState.recentActions[0]).toEqual(
      expect.objectContaining({
        actionType: 'borrow',
        status: 'signed',
        network: 'signet',
        origin: 'http://localhost:3002',
      }),
    );
    expect(storedState.selectedNetwork).toBe('mutinynet');
    expect(storedState.lastOrigin).toBe('http://localhost:3002');
  });

  it('clears recent actions without losing the selected network and origin', async () => {
    const { getStoredState } = setStateMock({
      recentActions: [
        {
          id: 'recent',
          actionType: 'transfer',
          network: 'signet',
          origin: 'http://localhost:3002',
          timestamp: 1_000,
          status: 'broadcast',
        },
      ],
      selectedNetwork: 'signet',
      lastOrigin: 'http://localhost:3002',
    });

    await clearRecentActions();

    expect(getStoredState()).toEqual({
      recentActions: [],
      selectedNetwork: 'signet',
      lastOrigin: 'http://localhost:3002',
    });
  });

  it('remembers the current Ducat origin without changing recent actions or selection', async () => {
    const { getStoredState } = setStateMock({ recentActions: [], selectedNetwork: 'signet' });

    await rememberDucatSession('https://dev.app.ducatprotocol.com');

    expect(getStoredState()).toEqual({
      recentActions: [],
      selectedNetwork: 'signet',
      lastOrigin: 'https://dev.app.ducatprotocol.com',
    });
  });

  it('preserves mainnet recent action and session metadata', async () => {
    setStateMock({
      recentActions: [
        {
          id: 'mainnet-action',
          actionType: 'deposit',
          network: 'mainnet',
          origin: 'https://app.ducatprotocol.com',
          timestamp: 1_000,
          status: 'signed',
        },
      ],
      selectedNetwork: 'mainnet',
      lastOrigin: 'https://app.ducatprotocol.com',
    });

    const state = await getState();

    expect(state.recentActions).toHaveLength(1);
    expect(state.recentActions[0]?.network).toBe('mainnet');
    expect(state.selectedNetwork).toBe('mainnet');
  });

  it('preserves key overrides when appending and clearing recent actions', async () => {
    const { getStoredState } = setStateMock({
      recentActions: [],
      keyOverrides: [keyOverride],
      selectedNetwork: 'signet',
      lastOrigin: 'https://app.ducatprotocol.com',
    });

    await appendRecentAction({
      actionType: 'send-unit',
      network: 'signet',
      origin: 'https://app.ducatprotocol.com',
      summary: 'Sent UNIT',
    });
    await clearRecentActions();

    expect((getStoredState() as DucatSnapState).keyOverrides).toEqual([keyOverride]);
  });

  it('does not drop key overrides when recent actions are malformed', async () => {
    setStateMock({
      recentActions: 'bad',
      keyOverrides: [keyOverride],
      selectedNetwork: 'signet',
      lastOrigin: 'https://app.ducatprotocol.com',
    });

    const state = await getState();

    expect(state.recentActions).toEqual([]);
    expect(state.keyOverrides).toEqual([keyOverride]);
  });

  it('loads valid network endpoint overrides from Snap state', async () => {
    setStateMock({
      recentActions: [],
      networkEndpointOverrides: {
        signet: {
          validator_base_url: 'https://validator-override.example',
          esplora_base_url: 'https://esplora-override.example/api',
          network_identity_verified: true,
        },
      },
    });

    const state = await getState();

    expect(state.networkEndpointOverrides?.signet).toEqual({
      validator_base_url: 'https://validator-override.example',
      esplora_base_url: 'https://esplora-override.example/api',
      network_identity_verified: true,
    });
  });

  it('drops malformed network endpoint overrides from Snap state', async () => {
    setStateMock({
      recentActions: [],
      networkEndpointOverrides: {
        signet: {
          validator_base_url: 'file:///tmp/validator',
          esplora_base_url: 'https://esplora-override.example/api',
          network_identity_verified: true,
        },
      },
    });

    const state = await getState();

    expect(state.networkEndpointOverrides).toBeUndefined();
  });

  it('drops legacy endpoint overrides without network identity proof', async () => {
    setStateMock({
      recentActions: [],
      networkEndpointOverrides: {
        signet: {
          validator_base_url: 'https://validator-override.example',
        },
      },
    });

    const state = await getState();

    expect(state.networkEndpointOverrides).toBeUndefined();
  });

  it('drops plaintext remote endpoint overrides from Snap state', async () => {
    setStateMock({
      recentActions: [],
      networkEndpointOverrides: {
        signet: {
          validator_base_url: 'http://validator-override.example',
          network_identity_verified: true,
        },
      },
    });

    const state = await getState();

    expect(state.networkEndpointOverrides).toBeUndefined();
  });
});
