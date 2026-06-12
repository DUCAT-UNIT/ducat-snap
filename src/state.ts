import type { DucatSnapState, RecentAction } from './types';

const MAX_RECENT_ACTIONS = 12;

function emptyState(): DucatSnapState {
  return { recentActions: [] };
}

function isRecentAction(value: unknown): value is RecentAction {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<RecentAction>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.actionType === 'string' &&
    (candidate.network === 'signet' || candidate.network === 'mutinynet') &&
    typeof candidate.origin === 'string' &&
    typeof candidate.timestamp === 'number'
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
    recentActions: storedState.recentActions.filter(isRecentAction).slice(0, MAX_RECENT_ACTIONS),
  };
}

export async function appendRecentAction(action: Omit<RecentAction, 'id' | 'timestamp'>): Promise<void> {
  const state = await getState();
  const nextState: DucatSnapState = {
    recentActions: [
      {
        ...action,
        id: `${Date.now()}-${state.recentActions.length}`,
        timestamp: Date.now(),
      },
      ...state.recentActions,
    ].slice(0, MAX_RECENT_ACTIONS),
  };

  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: nextState,
    },
  });
}
