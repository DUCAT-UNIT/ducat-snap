/** @fileoverview Fetches network account, balance, and vault summaries and renders Snap Home with data fallbacks. */
import { UserInputEventType, type OnUserInputHandler } from '@metamask/snaps-sdk';

import { DUCAT_MARK_SVG } from './brand';
import { networkLabel } from './display';
import { renderKeyOverrideContent, type KeyOverrideStatus } from './home-key-override';
import { renderNetworkSelector } from './home-network';
import { renderNetworkEndpointContent, type EndpointKind, type NetworkEndpointStatus } from './home-network-endpoints';
import { effectiveKeyOverride, getActiveAccountKeySet } from './key-overrides';
import { assertSelectedNetwork, getSelectedNetwork } from './network-selection';
import { effectiveNetworkProfile, networkProfile } from './network-profiles';
import { ducatAppUrl } from './networks';
import { getState } from './state';
import type { DucatAccount, DucatNetwork, RecentAction } from './types';
import { getWalletInventory } from './wallet-inventory';
import {
  uiBanner,
  uiBox,
  uiButton,
  uiCard,
  uiCopyable,
  uiHeading,
  uiRow,
  uiSection,
  uiText,
  type SnapElement,
} from './ui';

export type HomeScreen = 'overview' | 'key' | EndpointKind;

/**
 * Assembles the Snap home model from sanitized local state and effective network endpoints.
 * @param networkInput - Optional network identifier; defaults to the Snap-owned selection.
 * @returns Public account data plus display-only balances, vault status, and recent actions.
 * @remarks Remote balances and vault data are informational and are not authoritative for signing policy.
 */
export async function getHomeState(networkInput: unknown): Promise<{
  network: DucatNetwork;
  appUrl: string;
  accounts: {
    sats: string;
    runes: string;
    vault: string | null;
  };
  publicKeys: {
    sats: DucatAccount;
    runes: DucatAccount;
  };
  balances: {
    btcSats: string | null;
    unitActive: string | null;
    unitReserved: string | null;
    unitMixedActive: string | null;
    unitMixedReserved: string | null;
  };
  recentActions: RecentAction[];
}> {
  const state = await getState();
  const network = networkInput === undefined || networkInput === null
    ? state.selectedNetwork
    : await assertSelectedNetwork(networkInput);
  const keySet = await getActiveAccountKeySet(network);
  const vaultAccount = 'vault' in keySet.record ? keySet.record.vault : null;
  const inventory = await getWalletInventory(network).catch(() => null);

  return {
    network,
    appUrl: ducatAppUrl(state.lastOrigin),
    accounts: {
      sats: keySet.record.sats.address,
      runes: keySet.record.runes.address,
      vault: vaultAccount?.address ?? null,
    },
    publicKeys: {
      sats: keySet.record.sats,
      runes: keySet.record.runes,
    },
    balances: {
      btcSats: inventory?.balances.btcSats ?? null,
      unitActive: inventory?.balances.unitActive ?? null,
      unitReserved: inventory?.balances.unitReserved ?? null,
      unitMixedActive: inventory?.balances.unitMixedActive ?? null,
      unitMixedReserved: inventory?.balances.unitMixedReserved ?? null,
    },
    recentActions: state.recentActions,
  };
}

function btcBalance(value: string | null): string {
  return value === null ? 'Unavailable' : `${value} sats`;
}

function balanceAccountRow(label: string, balance: string, address: string): SnapElement {
  return uiRow(
    label,
    uiBox([
      uiText(balance, { alignment: 'end' }),
      uiCopyable(address),
    ]),
  );
}

function managedCopyableRow(label: string, value: string, manageName: string): SnapElement {
  return uiRow(
    label,
    uiBox([
      uiCopyable(value),
      uiButton('Manage', { name: manageName }),
    ]),
  );
}

async function createHomeInterface(ui: SnapElement, context: Record<string, unknown>): Promise<{ id: string }> {
  const id = await snap.request<string>({
    method: 'snap_createInterface',
    params: {
      ui,
      context,
    },
  });

  return { id };
}

export async function renderHomePage(networkInput?: unknown, status: KeyOverrideStatus = null): Promise<{ id: string }> {
  const { ui, context } = await renderHomeInterface(networkInput, { keyOverride: status }, 'overview');

  return createHomeInterface(ui, context);
}

export async function updateHomeInterface(
  id: string,
  networkInput?: unknown,
  statuses: { keyOverride?: KeyOverrideStatus; endpoints?: NetworkEndpointStatus; editingEndpoint?: EndpointKind | null } = {},
  screen: HomeScreen = 'overview',
): Promise<void> {
  const { ui, context } = await renderHomeInterface(networkInput, statuses, screen);
  await snap.request({
    method: 'snap_updateInterface',
    params: {
      id,
      ui,
      context,
    },
  });
}

async function renderHomeInterface(
  networkInput?: unknown,
  statuses: { keyOverride?: KeyOverrideStatus; endpoints?: NetworkEndpointStatus; editingEndpoint?: EndpointKind | null } = {},
  screen: HomeScreen = 'overview',
): Promise<{ ui: SnapElement; context: Record<string, unknown> }> {
  try {
    const homeState = await getHomeState(networkInput);
    const state = await getState();
    const override = effectiveKeyOverride(state.keyOverrides ?? [], homeState.network);
    const profile = effectiveNetworkProfile(homeState.network, state.networkEndpointOverrides ?? {});
    const defaultProfile = networkProfile(homeState.network);
    const effective = override
      ? { source: 'imported' as const, sats: override.sats, runes: override.runes }
      : { source: 'derived' as const, sats: homeState.publicKeys.sats, runes: homeState.publicKeys.runes };

    const header = uiCard({
      image: DUCAT_MARK_SVG,
      title: 'Ducat Snap',
      value: networkLabel(homeState.network),
    });

    if (screen === 'key') {
      return {
        context: { screen: 'key', network: homeState.network },
        ui: uiBox([
          header,
          uiSection([
            uiHeading('Bitcoin Master Key'),
            uiButton('Back', { name: 'home-back' }),
          ]),
          renderKeyOverrideContent({
            network: homeState.network,
            override,
            effective,
            status: statuses.keyOverride ?? null,
          }),
        ]),
      };
    }

    if (screen === 'validator' || screen === 'esplora') {
      return {
        context: { screen, network: homeState.network },
        ui: uiBox([
          header,
          uiSection([
            uiButton('Back', { name: 'home-back' }),
          ]),
          renderNetworkEndpointContent({
            network: homeState.network,
            profile,
            defaultProfile,
            editingEndpoint: statuses.editingEndpoint ?? null,
            endpoint: screen,
            status: statuses.endpoints ?? null,
          }),
        ]),
      };
    }

    return {
      context: { screen: 'home', network: homeState.network },
      ui: uiBox([
          header,
          uiSection([
            uiHeading('Overview'),
            renderNetworkSelector(homeState.network),
            balanceAccountRow('BTC', btcBalance(homeState.balances.btcSats), homeState.accounts.sats),
            balanceAccountRow(
              'UNIT',
              homeState.balances.unitActive === null
                ? 'Unavailable'
                : `${homeState.balances.unitActive} active / ${homeState.balances.unitReserved} reserved`,
              homeState.accounts.runes,
            ),
            managedCopyableRow('Bitcoin public key', effective.sats.pubkey, 'manage-key'),
            managedCopyableRow('Validator URL', profile.validator_base_url, 'manage-validator'),
            managedCopyableRow('Esplora URL', profile.esplora_base_url, 'manage-esplora'),
          ]),
          ...(homeState.balances.btcSats === null || homeState.balances.unitActive === null
            ? [uiBanner('Wallet data unavailable', 'warning', 'Repair the selected network endpoints, refresh wallet data, and rebuild the transaction. Message signing remains available; PSBT signing requires trusted wallet data.')]
            : []),
        ]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      context: { screen: 'home' },
      ui: uiBox([
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

export function isHomeNavigationEvent(name: string): boolean {
  return name === 'manage-key' || name === 'manage-validator' || name === 'manage-esplora' || name === 'home-back';
}

export const handleHomeNavigationInput: OnUserInputHandler = async ({ id, event }) => {
  if (event.type !== UserInputEventType.ButtonClickEvent || !('name' in event) || typeof event.name !== 'string' || !isHomeNavigationEvent(event.name)) {
    return;
  }

  const { network } = await getSelectedNetwork();
  const screen: HomeScreen =
    event.name === 'manage-key'
      ? 'key'
      : event.name === 'manage-validator'
        ? 'validator'
        : event.name === 'manage-esplora'
          ? 'esplora'
          : 'overview';
  await updateHomeInterface(id, network, {}, screen);
};
