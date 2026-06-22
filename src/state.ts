import type { DucatNetwork, DucatSnapState, RecentAction } from './types';

const MAX_RECENT_ACTIONS = 12;
const RECENT_ACTION_STATUSES = new Set(['signed', 'broadcast', 'failed']);
let fallbackIdCounter = 0;

function emptyState(): DucatSnapState {
  return { recentActions: [] };
}

function id(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  fallbackIdCounter += 1;
  return `${Date.now()}-${fallbackIdCounter}`;
}

function isRecentAction(value: unknown): value is RecentAction {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<RecentAction>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.actionType === 'string' &&
    (candidate.title === undefined || typeof candidate.title === 'string') &&
    (candidate.network === 'mainnet' || candidate.network === 'signet' || candidate.network === 'mutinynet' || candidate.network === 'regtest') &&
    typeof candidate.origin === 'string' &&
    Number.isFinite(candidate.timestamp) &&
    (candidate.status === undefined || RECENT_ACTION_STATUSES.has(candidate.status)) &&
    (candidate.txid === undefined || typeof candidate.txid === 'string') &&
    (candidate.summary === undefined || typeof candidate.summary === 'string') &&
    (candidate.amountSats === undefined || Number.isFinite(candidate.amountSats)) &&
    (candidate.unitAmount === undefined || Number.isFinite(candidate.unitAmount)) &&
    (candidate.details === undefined || isDetails(candidate.details))
  );
}

function isDetails(value: unknown): value is RecentAction['details'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (detail) => detail === null || typeof detail === 'string' || typeof detail === 'number' || typeof detail === 'boolean',
  );
}

export async function getState(): Promise<DucatSnapState> {
  const storedState = await snap.request<Partial<DucatSnapState> | null>({
    method: 'snap_manageState',
    params: { operation: 'get' },
  });

  if (!storedState || !Array.isArray(storedState.recentActions)) {
    return emptyState();
  }

  return {
    recentActions: storedState.recentActions
      .filter(isRecentAction)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, MAX_RECENT_ACTIONS),
    lastNetwork:
      storedState.lastNetwork === 'mainnet' ||
      storedState.lastNetwork === 'signet' ||
      storedState.lastNetwork === 'mutinynet' ||
      storedState.lastNetwork === 'regtest'
        ? storedState.lastNetwork
        : undefined,
    lastOrigin: typeof storedState.lastOrigin === 'string' ? storedState.lastOrigin : undefined,
  };
}

export async function appendRecentAction(action: Omit<RecentAction, 'id' | 'timestamp'>): Promise<void> {
  const state = await getState();
  const nextState: DucatSnapState = {
    recentActions: [
      {
        ...action,
        id: id(),
        timestamp: Date.now(),
        status: action.status ?? 'signed',
      },
      ...state.recentActions,
    ].slice(0, MAX_RECENT_ACTIONS),
    lastNetwork: action.network,
    lastOrigin: action.origin,
  };

  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: nextState,
    },
  });
}

export async function clearRecentActions(): Promise<void> {
  const state = await getState();
  const nextState: DucatSnapState = { recentActions: [] };

  if (state.lastNetwork) {
    nextState.lastNetwork = state.lastNetwork;
  }

  if (state.lastOrigin) {
    nextState.lastOrigin = state.lastOrigin;
  }

  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: nextState,
    },
  });
}

export async function rememberDucatSession(network: DucatNetwork, origin: string): Promise<void> {
  const state = await getState();

  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: {
        ...state,
        lastNetwork: network,
        lastOrigin: origin,
      },
    },
  });
}
