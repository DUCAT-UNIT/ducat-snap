import { appendRecentAction, clearRecentActions, getState, rememberDucatSession } from '../state';
import type { DucatSnapState } from '../types';

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

describe('Snap state', () => {
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
        { id: 'bad-network', actionType: 'deposit', network: 'mainnet', origin: 'http://localhost:3002', timestamp: 999 },
        { id: 'bad-details', actionType: 'deposit', network: 'signet', origin: 'http://localhost:3002', timestamp: 999, details: [] },
        ...validActions,
      ],
      lastNetwork: 'signet',
      lastOrigin: 'http://localhost:3002',
    });

    const state = await getState();

    expect(state.recentActions).toHaveLength(12);
    expect(state.recentActions[0]?.id).toBe('valid-13');
    expect(state.recentActions.at(-1)?.id).toBe('valid-2');
    expect(state.lastNetwork).toBe('signet');
    expect(state.lastOrigin).toBe('http://localhost:3002');
  });

  it('appends actions with default signed status and updates the last session', async () => {
    const { getStoredState } = setStateMock({
      recentActions: [],
      lastNetwork: 'mutinynet',
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
    expect(storedState.lastNetwork).toBe('signet');
    expect(storedState.lastOrigin).toBe('http://localhost:3002');
  });

  it('clears recent actions without losing the last connected network and origin', async () => {
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
      lastNetwork: 'signet',
      lastOrigin: 'http://localhost:3002',
    });

    await clearRecentActions();

    expect(getStoredState()).toEqual({
      recentActions: [],
      lastNetwork: 'signet',
      lastOrigin: 'http://localhost:3002',
    });
  });

  it('remembers the current Ducat session without changing recent actions', async () => {
    const { getStoredState } = setStateMock({ recentActions: [] });

    await rememberDucatSession('mutinynet', 'https://dev.app.ducatprotocol.com');

    expect(getStoredState()).toEqual({
      recentActions: [],
      lastNetwork: 'mutinynet',
      lastOrigin: 'https://dev.app.ducatprotocol.com',
    });
  });
});

