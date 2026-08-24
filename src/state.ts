/** @fileoverview Sanitizes persisted state and maintains bounded actions, sessions, keys, and endpoint overrides. */
import { artifactPolicy } from './artifact-policy';
import { ALL_DEPLOYMENT_IDS, bitcoinNetworkForDeployment } from './networks';
import { normalizeNetworkEndpointUrl } from './network-endpoint-policy';
import type {
  DucatAccount,
  DeploymentId,
  DucatSnapState,
  NetworkEndpointOverride,
  NetworkEndpointOverrides,
  PrivateKeyOverrideRecord,
  RecentAction,
} from './types';

const MAX_RECENT_ACTIONS = 12;
const RECENT_ACTION_STATUSES = new Set(['signed', 'broadcast', 'failed']);
// Networks accepted in persisted state. Derived from DUCAT_SUPPORTED_NETWORKS so
// storage validation stays aligned with the RPC and Home network selectors.
const STORED_DEPLOYMENTS = new Set<string>(ALL_DEPLOYMENT_IDS);

type RawStoredState = Partial<DucatSnapState> & {
  lastNetwork?: unknown;
  selectedNetwork?: unknown;
};

function isStoredDeployment(value: unknown): value is DeploymentId {
  return typeof value === 'string' && STORED_DEPLOYMENTS.has(value);
}

let fallbackIdCounter = 0;

function emptyState(): DucatSnapState {
  return { recentActions: [], selectedNetwork: artifactPolicy().default_deployment };
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
    isStoredDeployment(candidate.network) &&
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

function isHex(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`, 'iu').test(value);
}

function isDucatAccount(value: unknown, pubkeyBytes: 32 | 33): value is DucatAccount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const account = value as Partial<DucatAccount>;

  return typeof account.address === 'string' && isHex(account.pubkey, pubkeyBytes);
}

function isKeyOverride(value: unknown): value is PrivateKeyOverrideRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const account = value as Partial<PrivateKeyOverrideRecord>;

  return (
    typeof account.id === 'string' &&
    account.source === 'imported' &&
    isStoredDeployment(account.network) &&
    typeof account.created_at === 'number' &&
    Number.isFinite(account.created_at) &&
    typeof account.fingerprint === 'string' &&
    isHex(account.private_key, 32) &&
    isDucatAccount(account.sats, 33) &&
    isDucatAccount(account.runes, 32)
  );
}

function withKeyOverrides(state: DucatSnapState, keyOverrides: PrivateKeyOverrideRecord[]): DucatSnapState {
  if (!keyOverrides.length) {
    return state;
  }

  return {
    ...state,
    keyOverrides,
  };
}

function sanitizedNetworkEndpointOverrides(value: unknown): NetworkEndpointOverrides | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result: NetworkEndpointOverrides = {};

  for (const [networkInput, overrideInput] of Object.entries(value)) {
    if (!isStoredDeployment(networkInput) || !overrideInput || typeof overrideInput !== 'object' || Array.isArray(overrideInput)) {
      continue;
    }

    const override = overrideInput as Record<string, unknown>;
    if (override.network_identity_verified !== true) {
      continue;
    }
    const hasValidator = override.validator_base_url !== undefined;
    const hasEsplora = override.esplora_base_url !== undefined;
    let validatorUrl: string | undefined;
    let esploraUrl: string | undefined;
    try {
      validatorUrl = hasValidator
        ? normalizeNetworkEndpointUrl(override.validator_base_url, 'validator_base_url', bitcoinNetworkForDeployment(networkInput))
        : undefined;
      esploraUrl = hasEsplora
        ? normalizeNetworkEndpointUrl(override.esplora_base_url, 'esplora_base_url', bitcoinNetworkForDeployment(networkInput))
        : undefined;
    } catch {
      continue;
    }

    const next: NetworkEndpointOverride = { network_identity_verified: true };
    if (validatorUrl) {
      next.validator_base_url = validatorUrl;
    }
    if (esploraUrl) {
      next.esplora_base_url = esploraUrl;
    }
    if (next.validator_base_url || next.esplora_base_url) {
      result[networkInput] = next;
    }
  }

  return Object.keys(result).length ? result : undefined;
}

/**
 * Loads untrusted Snap state and retains only bounded schema-valid records and verified overrides.
 * @returns Sanitized state safe for wallet policy decisions.
 */
export async function getState(): Promise<DucatSnapState> {
  const storedState = await snap.request<RawStoredState | null>({
    method: 'snap_manageState',
    params: { operation: 'get' },
  });

  if (!storedState || typeof storedState !== 'object' || Array.isArray(storedState)) {
    return emptyState();
  }

  const recentActions = Array.isArray(storedState.recentActions) ? storedState.recentActions : [];
  const keyOverrides = Array.isArray(storedState.keyOverrides) ? storedState.keyOverrides.filter(isKeyOverride) : [];
  const networkEndpointOverrides = sanitizedNetworkEndpointOverrides(storedState.networkEndpointOverrides);

  const selectedNetwork = isStoredDeployment(storedState.selectedNetwork)
    ? storedState.selectedNetwork
    : isStoredDeployment(storedState.lastNetwork)
      ? storedState.lastNetwork
      : 'mutinynet';
  const state = withKeyOverrides({
    recentActions: recentActions
      .filter(isRecentAction)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, MAX_RECENT_ACTIONS),
    selectedNetwork,
    lastOrigin: typeof storedState.lastOrigin === 'string' ? storedState.lastOrigin : undefined,
  }, keyOverrides);
  const sanitizedState = networkEndpointOverrides ? { ...state, networkEndpointOverrides } : state;
  const needsMigration = !isStoredDeployment(storedState.selectedNetwork) || Object.prototype.hasOwnProperty.call(storedState, 'lastNetwork');

  if (needsMigration) {
    await snap.request({
      method: 'snap_manageState',
      params: {
        operation: 'update',
        newState: sanitizedState,
      },
    });
  }

  return sanitizedState;
}

/**
 * Prepends a timestamped action, bounds history, and remembers its origin.
 * @param action - Completed public action details without generated metadata.
 * @returns When the sanitized state update is persisted.
 */
export async function appendRecentAction(action: Omit<RecentAction, 'id' | 'timestamp'>): Promise<void> {
  const state = await getState();
  const nextState: DucatSnapState = {
    ...state,
    recentActions: [
      {
        ...action,
        id: id(),
        timestamp: Date.now(),
        status: action.status ?? 'signed',
      },
      ...state.recentActions,
    ].slice(0, MAX_RECENT_ACTIONS),
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

/** @returns When action history is cleared without altering keys, endpoints, or session metadata. */
export async function clearRecentActions(): Promise<void> {
  const state = await getState();
  const nextState: DucatSnapState = { ...state, recentActions: [] };

  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: nextState,
    },
  });
}

/**
 * Persists the most recent authorized origin without replacing other state.
 * @param origin - Authorized request origin.
 * @returns When the session metadata is persisted.
 */
export async function rememberDucatSession(origin: string): Promise<void> {
  const state = await getState();

  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: {
        ...state,
        lastOrigin: origin,
      },
    },
  });
}

/** @param network - Confirmed user-selected network. @returns When the selection is persisted. */
export async function setSelectedNetwork(network: DeploymentId): Promise<void> {
  const state = await getState();

  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: {
        ...state,
        selectedNetwork: network,
      },
    },
  });
}
