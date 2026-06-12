import { getAccountKeySet } from './accounts';
import { DUCAT_APP_URL, esploraUrl, normalizeNetwork, validatorUrls } from './networks';
import { getState } from './state';
import type { DucatNetwork } from './types';
import { divider, heading, panel, text } from './ui';

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

function shortAddress(address: string): string {
  return `${address.slice(0, 12)}...${address.slice(-8)}`;
}

async function fetchBtcBalance(network: DucatNetwork, address: string): Promise<number | null> {
  try {
    const response = await fetch(`${esploraUrl(network)}/address/${address}`);

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
      const response = await fetch(`${baseUrl}${path}`, {
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
  const network = normalizeNetwork(networkInput);
  const keySet = await getAccountKeySet(network);
  const state = await getState();
  const [btcSats, unit, vault] = await Promise.all([
    fetchBtcBalance(network, keySet.record.sats.address),
    fetchUnitBalance(network, keySet.record.runes.address),
    fetchVaultSummary(network, keySet.record.vault.pubkey),
  ]);

  return {
    network,
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

export async function renderHomePage(networkInput: unknown = 'mutinynet') {
  try {
    const homeState = await getHomeState(networkInput);
    const actions = homeState.recentActions.slice(0, 5).map((action) =>
      text(
        `${new Date(action.timestamp).toISOString().slice(0, 16)}Z - ${action.actionType} on ${action.network}${
          action.txid ? ` - ${action.txid.slice(0, 12)}...` : ''
        }`,
      ),
    );

    return {
      content: panel([
        heading('Ducat'),
        text(`**Network:** ${homeState.network}`),
        text(`**Sats:** ${shortAddress(homeState.accounts.sats)}`),
        text(`**Runes:** ${shortAddress(homeState.accounts.runes)}`),
        text(`**Vault:** ${shortAddress(homeState.accounts.vault)}`),
        divider(),
        text(`**BTC balance:** ${homeState.balances.btcSats === null ? 'Unavailable' : `${homeState.balances.btcSats} sats`}`),
        text(`**UNIT balance:** ${homeState.balances.unit === null ? 'Unavailable' : `${homeState.balances.unit} UNIT`}`),
        text(
          homeState.vault
            ? `**Vault status:** ${homeState.vault.status} - ${homeState.vault.btcLocked ?? 'unknown'} BTC locked / ${
                homeState.vault.unitBorrowed ?? 'unknown'
              } UNIT borrowed`
            : '**Vault status:** No vault found or unavailable.',
        ),
        divider(),
        heading('Ducat actions'),
        text(`[Create](${DUCAT_APP_URL}/?action=create) | [Deposit](${DUCAT_APP_URL}/?action=deposit) | [Borrow](${DUCAT_APP_URL}/?action=borrow)`),
        text(`[Repay](${DUCAT_APP_URL}/?action=repay) | [Withdraw](${DUCAT_APP_URL}/?action=withdraw) | [Swap](${DUCAT_APP_URL}/swap)`),
        text(`[Liquidations](${DUCAT_APP_URL}/liquidations)`),
        divider(),
        heading('Recent actions'),
        ...(actions.length ? actions : [text('No recent Ducat actions yet.')]),
      ]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      content: panel([heading('Ducat'), text(`Unable to load Snap home: ${message}`)]),
    };
  }
}
