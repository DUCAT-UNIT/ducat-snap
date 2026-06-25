import { getAccountKeySet } from './accounts';
import { DUCAT_MARK_SVG } from './brand';
import { formatMaybeBtcValue, formatSatsOnly, formatUnit, networkLabel } from './display';
import { ducatAppUrl, esploraUrl, normalizeNetwork, validatorUrls } from './networks';
import { getState } from './state';
import type { DucatNetwork, RecentAction } from './types';
import {
  uiBanner,
  uiBox,
  uiCard,
  uiHeading,
  uiRow,
  uiSection,
  type SnapElement,
} from './ui';

type AddressStats = {
  chain_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
  mempool_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
};

type UnitUtxoResponse = {
  data?: {
    asset_balance?: number;
  }[];
  outputs?: {
    spent?: boolean;
    unit_amount?: number;
  }[];
};

type VaultListResponse =
  | ValidatorVault[]
  | {
      data?: ValidatorVault[];
      items?: ValidatorVault[];
      vaults?: ValidatorVault[];
    };

type LegacyValidatorVault = {
  btc_locked?: number;
  collateral_ratio?: number;
  liquidation_price?: number;
  oracle_price?: number;
  unit_borrowed?: number;
  vault_id?: string;
  vault_last_action?: string;
  vault_tag?: string;
};

type ValidatorVault = LegacyValidatorVault & {
  root_txid?: string;
  thold_price?: number | null;
  unit_balance?: number;
  unit_price?: number | null;
  vault_action?: string;
  vault_balance?: number;
  vault_config?: {
    label?: string;
  } | null;
  vault_ratio?: number | null;
  vault_value?: number | null;
};

type LegacyVaultListResponse = {
  vaults?: ValidatorVault[];
};

type VaultSummary = {
  id: string;
  tag: string | null;
  status: string;
  btcLocked: number | null;
  unitBorrowed: number | null;
  collateralRatio: number | null;
  liquidationPrice: number | null;
  oraclePrice: number | null;
};

const JSON_CONTENT_TYPE = `application/${'json'}`;

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBtcBalance(network: DucatNetwork, address: string): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(`${esploraUrl(network)}/address/${address}`);

    if (!response.ok) {
      return null;
    }

    const stats = (await response.json()) as AddressStats;

    const values = [
      stats.chain_stats?.funded_txo_sum,
      stats.chain_stats?.spent_txo_sum,
      stats.mempool_stats?.funded_txo_sum,
      stats.mempool_stats?.spent_txo_sum,
    ];

    if (!values.every(isNonNegativeNumber)) {
      return null;
    }

    const balance = values[0] - values[1] + values[2] - values[3];

    return balance >= 0 ? balance : null;
  } catch {
    return null;
  }
}

async function postValidatorJson<ResponseBody>(network: DucatNetwork, path: string, body: Record<string, string>): Promise<ResponseBody | null> {
  for (const baseUrl of validatorUrls(network)) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': JSON_CONTENT_TYPE },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return (await response.json()) as ResponseBody;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function getValidatorJson<ResponseBody>(network: DucatNetwork, path: string): Promise<ResponseBody | null> {
  for (const baseUrl of validatorUrls(network)) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`);

      if (response.ok) {
        return (await response.json()) as ResponseBody;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

async function fetchUnitBalance(network: DucatNetwork, address: string): Promise<number | null> {
  const response =
    (await getValidatorJson<UnitUtxoResponse>(network, `/api/address/${encodePathSegment(address)}`)) ??
    (await postValidatorJson<UnitUtxoResponse>(network, '/api/unit_utxos_by_address', { address }));

  if (Array.isArray(response?.data)) {
    let unitCents = 0;

    for (const output of response.data) {
      if (!isNonNegativeNumber(output.asset_balance)) {
        return null;
      }

      unitCents += output.asset_balance;
    }

    return unitCents / 100;
  }

  if (!Array.isArray(response?.outputs)) {
    return null;
  }

  let unitCents = 0;

  for (const output of response.outputs) {
    if (output.spent) {
      continue;
    }

    if (!isNonNegativeNumber(output.unit_amount)) {
      return null;
    }

    unitCents += output.unit_amount;
  }

  return unitCents / 100;
}

function numberOrNull(value: unknown): number | null {
  return isNonNegativeNumber(value) ? value : null;
}

function listVaults(response: VaultListResponse | null): ValidatorVault[] {
  if (Array.isArray(response)) {
    return response;
  }

  for (const vaults of [response?.data, response?.items, response?.vaults]) {
    if (Array.isArray(vaults) && vaults.length > 0) {
      return vaults;
    }
  }

  return [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

async function fetchVaultSummary(network: DucatNetwork, vaultPubkey: string): Promise<VaultSummary | null> {
  const response =
    (await getValidatorJson<VaultListResponse>(network, `/api/vault/pubkey/${encodePathSegment(vaultPubkey)}`)) ??
    (await postValidatorJson<LegacyVaultListResponse>(network, '/api/vault_list', { vault_pubkey: vaultPubkey }));
  const vault = listVaults(response)[0];
  const id = firstString(vault?.root_txid, vault?.vault_id);

  if (!vault || !id) {
    return null;
  }

  const unitBalanceCents = numberOrNull(vault.unit_balance);
  const vaultBalanceSats = numberOrNull(vault.vault_balance);

  return {
    id,
    tag: firstString(vault.vault_config?.label, vault.vault_tag),
    status: firstString(vault.vault_action, vault.vault_last_action) ?? 'Unknown',
    btcLocked: vaultBalanceSats === null ? numberOrNull(vault.btc_locked) : vaultBalanceSats / 100_000_000,
    unitBorrowed: unitBalanceCents === null ? numberOrNull(vault.unit_borrowed) : unitBalanceCents / 100,
    collateralRatio: numberOrNull(vault.vault_ratio) ?? numberOrNull(vault.collateral_ratio),
    liquidationPrice: numberOrNull(vault.thold_price) ?? numberOrNull(vault.liquidation_price),
    oraclePrice: numberOrNull(vault.unit_price) ?? numberOrNull(vault.oracle_price),
  };
}

export async function getHomeState(networkInput: unknown): Promise<{
  network: DucatNetwork;
  appUrl: string;
  accounts: {
    sats: string;
    runes: string;
    vault: string;
  };
  balances: {
    btcSats: number | null;
    unit: number | null;
  };
  vault: VaultSummary | null;
  recentActions: RecentAction[];
}> {
  const state = await getState();
  const network = networkInput === undefined || networkInput === null ? state.lastNetwork ?? 'mutinynet' : normalizeNetwork(networkInput);
  const keySet = await getAccountKeySet(network);
  const [btcSats, unit, vault] = await Promise.all([
    fetchBtcBalance(network, keySet.record.sats.address),
    fetchUnitBalance(network, keySet.record.runes.address),
    fetchVaultSummary(network, keySet.record.vault.pubkey),
  ]);

  return {
    network,
    appUrl: ducatAppUrl(state.lastOrigin),
    accounts: {
      sats: keySet.record.sats.address,
      runes: keySet.record.runes.address,
      vault: keySet.record.vault.address,
    },
    balances: {
      btcSats,
      unit,
    },
    vault,
    recentActions: state.recentActions,
  };
}

function statusLabel(status: string): string {
  return status
    .replace(/_/gu, ' ')
    .replace(/-/gu, ' ')
    .replace(/\b\w/gu, (char: string) => char.toUpperCase());
}

function usdLabel(value: number | null): string {
  return value === null ? 'Unknown' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// Human-readable host the BTC balance lookup contacts, for the privacy disclosure (SAY-08).
function balanceLookupHost(network: DucatNetwork): string {
  try {
    return new URL(esploraUrl(network)).host;
  } catch {
    return 'the configured esplora service';
  }
}

function collateralRatioLabel(value: number | null): string | undefined {
  // The validator returns the collateral ratio as a multiplier (e.g. 6.2333 = 623.33%),
  // so it is always scaled by 100. The previous `value < 20 ? *100 : value` magnitude
  // guess understated any genuine ratio >= 20 by 100x and created a discontinuity at the
  // boundary (SAY-03); a ratio of 20 is a healthy 2000% vault, not 20%.
  if (value === null || value <= 0) {
    return undefined;
  }

  const formatted = (value * 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

  return `${formatted}% collateral`;
}

function btcAmount(value: number | null): string {
  return value === null
    ? 'Unknown'
    : `${value.toLocaleString('en-US', {
        maximumFractionDigits: 8,
        minimumFractionDigits: 0,
      })} BTC`;
}

function btcBalance(value: number | null): string {
  return value === null ? 'Unavailable' : `${formatMaybeBtcValue(value)} (${formatSatsOnly(value)})`;
}

function unitAmount(value: number | null): string {
  return value === null ? 'Unknown' : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} UNIT`;
}

function vaultComponents(vault: VaultSummary | null): SnapElement[] {
  if (!vault) {
    return [
      uiCard({
        description: 'Create or connect a vault in the Ducat app.',
        title: 'Vault',
        value: 'No vault found',
      }),
    ];
  }

  return [
    uiCard({
      description: vault.tag ?? vault.id,
      extra: collateralRatioLabel(vault.collateralRatio),
      title: 'Vault',
      value: statusLabel(vault.status),
    }),
    uiRow('Collateral', btcAmount(vault.btcLocked)),
    uiRow('Debt', unitAmount(vault.unitBorrowed)),
    uiRow('Liquidation price', usdLabel(vault.liquidationPrice)),
    uiRow('Oracle price', usdLabel(vault.oraclePrice)),
  ];
}

export async function renderHomePage(networkInput?: unknown): Promise<{ content: SnapElement }> {
  try {
    const homeState = await getHomeState(networkInput);

    return {
      content: uiBox([
        uiCard({
          description: 'Bitcoin accounts and Ducat signing',
          extra: 'mainnet enabled',
          image: DUCAT_MARK_SVG,
          title: 'Ducat Snap',
          value: networkLabel(homeState.network),
        }),
        uiSection([
          uiHeading('Overview'),
          uiRow('Network', networkLabel(homeState.network)),
          uiRow('BTC', btcBalance(homeState.balances.btcSats)),
          uiRow('UNIT', formatUnit(homeState.balances.unit)),
        ]),
        // Disclose that loading this page (and the ducat_getHomeState RPC) sends the user's
        // addresses to third-party balance/validator services (SAY-08). The lookups are
        // first-party HTTPS and carry no private-key material, but the network contact is
        // not otherwise visible.
        uiBanner(
          'Balance lookups contact external services',
          'info',
          `Opening this page sends your BTC address to ${balanceLookupHost(homeState.network)} and your UNIT/vault keys to the Ducat validator to fetch balances. No private keys ever leave the Snap.`,
        ),
        ...(homeState.balances.btcSats === null || homeState.balances.unit === null
          ? [uiBanner('Balance lookup unavailable', 'warning', 'One or more balance services are unavailable or timed out. Signing still works from PSBT data supplied by the Ducat app.')]
          : []),
        uiSection([
          uiHeading('Vault'),
          ...vaultComponents(homeState.vault),
        ]),
      ]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      content: uiBox([
        uiCard({
          description: 'Bitcoin accounts and Ducat signing',
          image: DUCAT_MARK_SVG,
          title: 'Ducat Snap',
          value: 'Unavailable',
        }),
        uiBanner('Unable to load Snap Home', 'warning', message),
      ]),
    };
  }
}
