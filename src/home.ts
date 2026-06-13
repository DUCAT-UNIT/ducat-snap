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
  outputs?: {
    spent?: boolean;
    unit_amount?: number;
  }[];
};

type VaultListResponse = {
  vaults?: ValidatorVault[];
};

type ValidatorVault = {
  btc_locked?: number;
  collateral_ratio?: number;
  liquidation_price?: number;
  oracle_price?: number;
  unit_borrowed?: number;
  vault_id?: string;
  vault_last_action?: string;
  vault_tag?: string;
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

async function postValidatorJson<T>(network: DucatNetwork, path: string, body: Record<string, string>): Promise<T | null> {
  for (const baseUrl of validatorUrls(network)) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': JSON_CONTENT_TYPE },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return (await response.json()) as T;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return null;
      }
    }
  }

  return null;
}

async function fetchUnitBalance(network: DucatNetwork, address: string): Promise<number | null> {
  const response = await postValidatorJson<UnitUtxoResponse>(network, '/api/unit_utxos_by_address', { address });

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

async function fetchVaultSummary(network: DucatNetwork, vaultPubkey: string): Promise<VaultSummary | null> {
  const response = await postValidatorJson<VaultListResponse>(network, '/api/vault_list', { vault_pubkey: vaultPubkey });
  const vault = response?.vaults?.[0];

  if (!vault?.vault_id) {
    return null;
  }

  return {
    id: vault.vault_id,
    tag: typeof vault.vault_tag === 'string' && vault.vault_tag ? vault.vault_tag : null,
    status: typeof vault.vault_last_action === 'string' && vault.vault_last_action ? vault.vault_last_action : 'Unknown',
    btcLocked: numberOrNull(vault.btc_locked),
    unitBorrowed: numberOrNull(vault.unit_borrowed),
    collateralRatio: numberOrNull(vault.collateral_ratio),
    liquidationPrice: numberOrNull(vault.liquidation_price),
    oraclePrice: numberOrNull(vault.oracle_price),
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

function collateralRatioLabel(value: number | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const percent = value > 0 && value < 20 ? value * 100 : value;
  const formatted = percent.toLocaleString('en-US', { maximumFractionDigits: 2 });

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

export async function renderHomePage(networkInput?: unknown) {
  try {
    const homeState = await getHomeState(networkInput);

    return {
      content: uiBox([
        uiCard({
          description: 'Bitcoin accounts and Ducat signing',
          extra: 'testnet only',
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
