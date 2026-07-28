/** @fileoverview Fetches, validates, caches, and invalidates complete wallet-owned BTC/UNIT snapshots. */
import { get_vault_terms } from '@ducat-unit/core/lib';

import { ducatError, isDucatSnapError } from './errors';
import { getActiveAccountKeySet, type SelectedAccountKeySet } from './key-overrides';
import { verifyNetworkEndpointIdentity } from './network-endpoint-policy';
import { getEffectiveNetworkProfile, type NetworkProfile } from './network-profiles';
import { normalizeNetwork } from './networks';
import type {
  DucatNetwork,
  WalletBtcUtxo,
  WalletInventoryResponse,
  WalletUnitUtxo,
} from './types';

const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_INVENTORY_ROWS = 10_000;
const TXID_PATTERN = /^[0-9a-f]{64}$/iu;
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/iu;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/u;
const COIN_ID_PATTERN = /^([0-9a-f]{64}):([0-9]+)$/iu;
const ASSET_ID_PATTERN = /^[0-9]+:[0-9]+$/u;

type InventoryDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  resolveAccount?: (network: DucatNetwork) => Promise<SelectedAccountKeySet>;
  resolveProfile?: (network: DucatNetwork) => Promise<NetworkProfile>;
  verifyEndpoint?: typeof verifyNetworkEndpointIdentity;
};

type CacheEntry = {
  identity: string;
  snapshot: WalletInventoryResponse;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mismatch(message: string, details?: Record<string, unknown>): never {
  throw ducatError('WALLET_DATA_MISMATCH', message, details);
}

function safeIndex(value: unknown, field: string, row: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    mismatch('Wallet inventory data did not match the selected account.', { field, row });
  }
  return Number(value);
}

function safeSats(value: unknown, field: string, row: number): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    mismatch('Wallet inventory data did not match the selected account.', { field, row });
  }
  return Number(value);
}

function decimal(value: unknown, field: string, row: number): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      mismatch('Wallet inventory data did not match the selected account.', { field, row });
    }
    return String(value);
  }
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    mismatch('Wallet inventory data did not match the selected account.', { field, row });
  }
  return value;
}

function responseRows(value: unknown, label: string): unknown[] {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : null;
  if (!rows || rows.length > MAX_INVENTORY_ROWS) {
    mismatch(`The ${label} wallet inventory response was malformed.`);
  }
  return rows;
}

function canonicalAssetId(proto: unknown): string {
  if (!isRecord(proto) || !Array.isArray(proto.proto_terms)) {
    mismatch('The validator protocol identity response was malformed.');
  }
  try {
    const terms = get_vault_terms(proto.proto_terms);
    if (typeof terms.unit_asset_id !== 'string' || !ASSET_ID_PATTERN.test(terms.unit_asset_id)) {
      mismatch('The validator protocol identity response was malformed.');
    }
    return terms.unit_asset_id;
  } catch (error) {
    if (isDucatSnapError(error)) throw error;
    mismatch('The validator protocol identity response was malformed.');
  }
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw ducatError('WALLET_DATA_UNAVAILABLE', 'Wallet data is temporarily unavailable.');
  }
  if (!response.ok) {
    throw ducatError('WALLET_DATA_UNAVAILABLE', 'Wallet data is temporarily unavailable.', { status: response.status });
  }
  try {
    return await response.json();
  } catch {
    mismatch('A wallet data service returned malformed data.');
  }
}

function parseBtcRows(value: unknown, expectedScript: string): WalletBtcUtxo[] {
  const seen = new Set<string>();
  return responseRows(value, 'Bitcoin').map((row, index) => {
    if (!isRecord(row)) mismatch('The Bitcoin wallet inventory response was malformed.', { row: index });
    const txid = typeof row.txid === 'string' ? row.txid.toLowerCase() : '';
    const candidateScript = typeof row.scriptpubkey === 'string'
      ? row.scriptpubkey.toLowerCase()
      : typeof row.scriptPubKey === 'string'
        ? row.scriptPubKey.toLowerCase()
        : expectedScript;
    if (!TXID_PATTERN.test(txid) || !HEX_PATTERN.test(candidateScript) || candidateScript !== expectedScript) {
      mismatch('Bitcoin wallet data did not match the active account.', { row: index });
    }
    const vout = safeIndex(row.vout, 'vout', index);
    const outpoint = `${txid}:${vout}`;
    if (seen.has(outpoint)) mismatch('The Bitcoin wallet inventory contained a duplicate output.', { row: index });
    seen.add(outpoint);
    return {
      txid,
      vout,
      valueSats: safeSats(row.value, 'value', index),
      scriptPubKey: expectedScript,
    };
  });
}

function parseUnitRows(value: unknown, assetId: string, expectedScript: string): WalletUnitUtxo[] {
  const seen = new Set<string>();
  return responseRows(value, 'UNIT').flatMap((row, index) => {
    if (!isRecord(row)) mismatch('The UNIT wallet inventory response was malformed.', { row: index });
    if (row.asset_id !== assetId) return [];
    const coinId = typeof row.coin_id === 'string' ? row.coin_id.toLowerCase() : '';
    const match = COIN_ID_PATTERN.exec(coinId);
    const script = typeof row.coin_script === 'string' ? row.coin_script.toLowerCase() : '';
    if (!match || !HEX_PATTERN.test(script) || script !== expectedScript) {
      mismatch('UNIT wallet data did not match the active account.', { row: index });
    }
    const vout = safeIndex(Number(match[2]), 'coin_id', index);
    if (seen.has(coinId)) mismatch('The UNIT wallet inventory contained a duplicate output.', { row: index });
    seen.add(coinId);
    const activeAmount = decimal(row.asset_balance, 'asset_balance', index);
    const reservedAmount = decimal(row.asset_reserve, 'asset_reserve', index);
    const active = BigInt(activeAmount);
    const reserved = BigInt(reservedAmount);
    const classification = active > 0n && reserved > 0n
      ? 'mixed'
      : reserved > 0n
        ? 'reserved'
        : 'active';
    return [{
      txid: match[1].toLowerCase(),
      vout,
      coinId,
      coinValueSats: safeSats(row.coin_value, 'coin_value', index),
      scriptPubKey: expectedScript,
      assetId,
      activeAmount,
      reservedAmount,
      classification,
    } satisfies WalletUnitUtxo];
  });
}

function identity(network: DucatNetwork, account: SelectedAccountKeySet, profile: NetworkProfile): string {
  return [network, account.record.sats.address, account.record.runes.address, profile.validator_base_url, profile.esplora_base_url].join('|');
}

function totals(rows: WalletUnitUtxo[]): WalletInventoryResponse['balances'] {
  let active = 0n;
  let reserved = 0n;
  let mixedActive = 0n;
  let mixedReserved = 0n;
  for (const row of rows) {
    if (row.classification === 'active') active += BigInt(row.activeAmount);
    else if (row.classification === 'reserved') reserved += BigInt(row.reservedAmount);
    else {
      mixedActive += BigInt(row.activeAmount);
      mixedReserved += BigInt(row.reservedAmount);
    }
  }
  return {
    btcSats: '0',
    btcUtxos: 0,
    unitActive: active.toString(),
    unitReserved: reserved.toString(),
    unitMixedActive: mixedActive.toString(),
    unitMixedReserved: mixedReserved.toString(),
  };
}

export class WalletInventoryService {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #resolveAccount: (network: DucatNetwork) => Promise<SelectedAccountKeySet>;
  readonly #resolveProfile: (network: DucatNetwork) => Promise<NetworkProfile>;
  readonly #verifyEndpoint: typeof verifyNetworkEndpointIdentity;
  readonly #cache = new Map<DucatNetwork, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<WalletInventoryResponse>>();

  constructor(dependencies: InventoryDependencies = {}) {
    this.#fetch = dependencies.fetchImpl ?? fetch;
    this.#now = dependencies.now ?? Date.now;
    this.#resolveAccount = dependencies.resolveAccount ?? getActiveAccountKeySet;
    this.#resolveProfile = dependencies.resolveProfile ?? getEffectiveNetworkProfile;
    this.#verifyEndpoint = dependencies.verifyEndpoint ?? verifyNetworkEndpointIdentity;
  }

  invalidate(network?: DucatNetwork): void {
    if (network) this.#cache.delete(network);
    else this.#cache.clear();
  }

  async get(networkInput: unknown, options: { fresh?: boolean } = {}): Promise<WalletInventoryResponse> {
    const network = normalizeNetwork(networkInput);
    const [account, profile] = await Promise.all([this.#resolveAccount(network), this.#resolveProfile(network)]);
    const cacheIdentity = identity(network, account, profile);
    const now = this.#now();
    const cached = this.#cache.get(network);
    if (!options.fresh && cached?.identity === cacheIdentity && cached.snapshot.expiresAt > now) {
      return cached.snapshot;
    }
    const pending = this.#inFlight.get(cacheIdentity);
    if (pending) return pending;
    const refresh = this.#refresh(network, account, profile, cacheIdentity);
    this.#inFlight.set(cacheIdentity, refresh);
    try {
      return await refresh;
    } finally {
      this.#inFlight.delete(cacheIdentity);
    }
  }

  async #refresh(
    network: DucatNetwork,
    account: SelectedAccountKeySet,
    profile: NetworkProfile,
    cacheIdentity: string,
  ): Promise<WalletInventoryResponse> {
    try {
      await Promise.all([
        this.#verifyEndpoint(network, 'validator', profile.validator_base_url, this.#fetch),
        this.#verifyEndpoint(network, 'esplora', profile.esplora_base_url, this.#fetch),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('not on') || message.includes('malformed')) {
        mismatch('A wallet data service did not match the selected Bitcoin network.');
      }
      throw ducatError('WALLET_DATA_UNAVAILABLE', 'Wallet data is temporarily unavailable.');
    }

    const [proto, btcResponse, unitResponse] = await Promise.all([
      fetchJson(this.#fetch, `${profile.validator_base_url}/api/proto/latest`),
      fetchJson(this.#fetch, `${profile.esplora_base_url}/address/${account.record.sats.address}/utxo`),
      fetchJson(this.#fetch, `${profile.validator_base_url}/api/address/${account.record.runes.address}`),
    ]);
    const assetId = canonicalAssetId(proto);
    const btcUtxos = parseBtcRows(btcResponse, account.satsOutputScript.toString('hex'));
    const unitUtxos = parseUnitRows(unitResponse, assetId, account.runesOutputScript.toString('hex'));
    const balances = totals(unitUtxos);
    balances.btcSats = btcUtxos.reduce((sum, row) => sum + BigInt(row.valueSats), 0n).toString();
    balances.btcUtxos = btcUtxos.length;
    const observedAt = this.#now();
    const snapshot: WalletInventoryResponse = {
      network,
      observedAt,
      expiresAt: observedAt + CACHE_TTL_MS,
      assetId,
      account: account.record,
      balances,
      btcUtxos,
      unitUtxos,
    };
    this.#cache.set(network, { identity: cacheIdentity, snapshot });
    return snapshot;
  }
}

export const walletInventoryService = new WalletInventoryService();

export function invalidateWalletInventory(network?: DucatNetwork): void {
  walletInventoryService.invalidate(network);
}

export async function getWalletInventory(network: unknown, options?: { fresh?: boolean }): Promise<WalletInventoryResponse> {
  return walletInventoryService.get(network, options);
}
