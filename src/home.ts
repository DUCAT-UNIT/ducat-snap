import { getAccountKeySet } from './accounts';
import { actionLabel, formatMaybeBtcValue, formatSats, formatSatsOnly, formatUnit, networkLabel, truncateMiddle } from './display';
import { ducatAppUrl, esploraUrl, normalizeNetwork, validatorUrls } from './networks';
import { getState } from './state';
import type { DucatNetwork } from './types';
import {
  uiBanner,
  uiBox,
  uiCard,
  uiCollapsibleSection,
  uiCopyable,
  uiHeading,
  uiLink,
  uiMuted,
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

    return (
      stats.chain_stats.funded_txo_sum -
      stats.chain_stats.spent_txo_sum +
      stats.mempool_stats.funded_txo_sum -
      stats.mempool_stats.spent_txo_sum
    );
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

  const unitCents = response.outputs.reduce((total, output) => {
    if (output.spent || typeof output.unit_amount !== 'number') {
      return total;
    }

    return total + output.unit_amount;
  }, 0);

  return unitCents / 100;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  recentActions: Awaited<ReturnType<typeof getState>>['recentActions'];
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

function recentActionLine(action: Awaited<ReturnType<typeof getState>>['recentActions'][number]): string {
  const ageMs = Math.max(0, Date.now() - action.timestamp);
  const ageMinutes = Math.floor(ageMs / 60_000);
  const when =
    ageMinutes < 1
      ? 'just now'
      : ageMinutes < 60
        ? `${ageMinutes}m ago`
        : ageMinutes < 1_440
          ? `${Math.floor(ageMinutes / 60)}h ago`
          : new Date(action.timestamp).toISOString().slice(0, 10);
  const status = statusLabel(action.status ?? 'signed');
  const amount = action.amountSats === undefined ? '' : ` - ${formatSats(action.amountSats, action.network)}`;
  const txid = action.txid ? ` - tx ${truncateMiddle(action.txid, 8, 6)}` : '';

  return `${when} - ${actionLabel({ title: action.title, actionType: action.actionType })} - ${status}${amount}${txid}`;
}

function recentActionComponents(actions: Awaited<ReturnType<typeof getState>>['recentActions']): SnapElement[] {
  if (!actions.length) {
    return [uiMuted('No recent Ducat actions yet.')];
  }

  return actions.flatMap((action, index) => [
    uiRow(`#${index + 1}`, recentActionLine(action)),
    ...(action.txid ? [uiRow('Txid', uiCopyable(action.txid))] : []),
  ]);
}

function actionUrl(appUrl: string, path: string): string {
  return `${appUrl}${path}`;
}

function canRenderSnapLink(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;

    return protocol === 'https:' || protocol === 'mailto:' || protocol === 'metamask:';
  } catch {
    return false;
  }
}

function actionComponents(appUrl: string): SnapElement[] {
  const actions = [
    ['Create', '/?action=create'],
    ['Deposit', '/?action=deposit'],
    ['Borrow', '/?action=borrow'],
    ['Repay', '/?action=repay'],
    ['Withdraw', '/?action=withdraw'],
    ['Swap', '/swap'],
    ['Liquidations', '/liquidations'],
  ] as const;

  if (canRenderSnapLink(appUrl)) {
    return actions.map(([label, path]) => uiRow(label, uiLink('Open', actionUrl(appUrl, path))));
  }

  return [
    uiMuted('Local routes are copyable because MetaMask Snap Home only opens HTTPS, mailto, and metamask links.'),
    ...actions.map(([label, path]) => uiRow(label, uiCopyable(actionUrl(appUrl, path)))),
  ];
}

export async function renderHomePage(networkInput?: unknown) {
  try {
    const homeState = await getHomeState(networkInput);
    const actions = homeState.recentActions.slice(0, 5);

    return {
      content: uiBox([
        uiHeading('Ducat', 'lg'),
        uiMuted(networkLabel(homeState.network)),
        uiBanner('Testnet release', 'info', 'Mainnet is disabled. Use the Ducat app for create, deposit, borrow, repay, withdraw, swap, and liquidation flows.'),
        uiSection([
          uiHeading('Overview'),
          uiCard({
            description: 'Spendable testnet BTC',
            extra: homeState.balances.btcSats === null ? undefined : formatSatsOnly(homeState.balances.btcSats),
            title: 'BTC balance',
            value: formatMaybeBtcValue(homeState.balances.btcSats),
          }),
          uiCard({
            description: 'Ducat validator balance',
            title: 'UNIT balance',
            value: formatUnit(homeState.balances.unit),
          }),
        ]),
        uiSection([
          uiHeading('Accounts'),
          uiRow('BTC', uiCopyable(homeState.accounts.sats)),
          uiRow('UNIT / Runes', uiCopyable(homeState.accounts.runes)),
          uiRow('Vault', uiCopyable(homeState.accounts.vault)),
        ]),
        ...(homeState.balances.btcSats === null || homeState.balances.unit === null
          ? [uiBanner('Balance lookup unavailable', 'warning', 'One or more balance services are unavailable or timed out. Signing still works from PSBT data supplied by the Ducat app.')]
          : []),
        uiSection([
          uiHeading('Vault'),
          ...(homeState.vault
            ? [
                uiRow('Status', statusLabel(homeState.vault.status)),
                uiRow('Vault ID', homeState.vault.tag ?? homeState.vault.id),
                uiRow('BTC locked', homeState.vault.btcLocked === null ? 'Unknown' : `${homeState.vault.btcLocked} BTC`),
                uiRow('UNIT borrowed', homeState.vault.unitBorrowed === null ? 'Unknown' : `${homeState.vault.unitBorrowed} UNIT`),
                uiRow('Collateral', homeState.vault.collateralRatio === null ? 'Unknown' : `${homeState.vault.collateralRatio}%`),
                uiRow('Liquidation', homeState.vault.liquidationPrice === null ? 'Unknown' : `$${homeState.vault.liquidationPrice}`),
                uiRow('Oracle', homeState.vault.oraclePrice === null ? 'Unknown' : `$${homeState.vault.oraclePrice}`),
              ]
            : [uiMuted('No vault found, or the Ducat validator is unavailable.')]),
        ]),
        uiCollapsibleSection('Ducat actions', actionComponents(homeState.appUrl), true),
        uiCollapsibleSection('Recent actions', recentActionComponents(actions), true),
      ]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      content: uiBox([uiHeading('Ducat', 'lg'), uiBanner('Unable to load Snap Home', 'warning', message)]),
    };
  }
}
