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
const COMPILED_STATE_POLICY = process.env.DUCAT_SNAP_ARTIFACT_POLICY;
// Networks accepted in persisted state. Derived from DUCAT_SUPPORTED_NETWORKS so
// storage validation stays aligned with the RPC and Home network selectors.
const STORED_DEPLOYMENTS = new Set<string>(ALL_DEPLOYMENT_IDS);

type RawStoredState = Partial<DucatSnapState> & {
  lastNetwork?: unknown;
  selectedNetwork?: unknown;
};

type StoredStateValue<Key extends keyof DucatSnapState> = Exclude<DucatSnapState[Key], undefined>;

let stateMutationQueue: Promise<void> = Promise.resolve();

async function serializeStateMutation<Result>(mutation: () => Promise<Result>): Promise<Result> {
  const result = stateMutationQueue.then(mutation, mutation);
  stateMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

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
 * Persists one state field without replacing unrelated state written by another request.
 * @param key - Top-level Snap state field.
 * @param value - JSON-safe value for the field.
 * @returns When MetaMask has persisted the keyed update.
 */
export async function setStateField<Key extends keyof DucatSnapState>(
  key: Key,
  value: StoredStateValue<Key>,
): Promise<void> {
  await snap.request({
    method: 'snap_setState',
    params: { key, value },
  });
}

/**
 * Serializes read-modify-write mutations and persists only their affected field.
 * @param key - Top-level Snap state field.
 * @param update - Pure field update computed from the latest sanitized state.
 * @returns When the mutation has been persisted.
 */
export async function updateStateField<Key extends keyof DucatSnapState>(
  key: Key,
  update: (state: DucatSnapState) => StoredStateValue<Key>,
): Promise<void> {
  await serializeStateMutation(async () => {
    const state = await getState();
    await setStateField(key, update(state));
  });
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
  // Alpha and development artifacts repair selections against their compiled authority.
  // Production keeps its established state behavior so the reviewed package bundle and
  // manifest remain byte-for-byte unchanged; its RPC boundary still rejects alpha before
  // wallet side effects.
  const selectedNetwork = COMPILED_STATE_POLICY === 'alpha-mainnet'
    ? (storedState.selectedNetwork === 'alpha-mainnet' ? 'alpha-mainnet' : artifactPolicy().default_deployment)
    : COMPILED_STATE_POLICY === 'development'
      ? (isStoredDeployment(storedState.selectedNetwork) && artifactPolicy().allowed_deployments.includes(storedState.selectedNetwork)
          ? storedState.selectedNetwork
          : artifactPolicy().default_deployment)
    : isStoredDeployment(storedState.selectedNetwork)
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
  const needsMigration = COMPILED_STATE_POLICY === 'alpha-mainnet' || COMPILED_STATE_POLICY === 'development'
    ? storedState.selectedNetwork !== selectedNetwork
    : !isStoredDeployment(storedState.selectedNetwork);

  if (needsMigration) {
    await setStateField('selectedNetwork', selectedNetwork);
  }

  return sanitizedState;
}

/**
 * Prepends a timestamped action, bounds history, and remembers its origin.
 * @param action - Completed public action details without generated metadata.
 * @returns When the sanitized state update is persisted.
 */
export async function appendRecentAction(action: Omit<RecentAction, 'id' | 'timestamp'>): Promise<void> {
  await updateStateField('recentActions', (state) => [
    {
      ...action,
      id: id(),
      timestamp: Date.now(),
      status: action.status ?? 'signed',
    },
    ...state.recentActions,
  ].slice(0, MAX_RECENT_ACTIONS));
  await setStateField('lastOrigin', action.origin);
}

/** @returns When action history is cleared without altering keys, endpoints, or session metadata. */
export async function clearRecentActions(): Promise<void> {
  await updateStateField('recentActions', () => []);
}

/**
 * Persists the most recent authorized origin without replacing other state.
 * @param origin - Authorized request origin.
 * @returns When the session metadata is persisted.
 */
export async function rememberDucatSession(origin: string): Promise<void> {
  await setStateField('lastOrigin', origin);
}

/** @param network - Confirmed user-selected network. @returns When the selection is persisted. */
export async function setSelectedNetwork(network: DeploymentId): Promise<void> {
  await setStateField('selectedNetwork', network);
}
