/** @fileoverview Renders native Home and Settings with real balances and display-only USD estimates. */
import { UserInputEventType, type OnUserInputHandler } from '@metamask/snaps-sdk';

import { DUCAT_MARK_SVG } from './brand';
import { Container, Image } from '@metamask/snaps-sdk/jsx';
import { homeAssetUsd, homeBitcoinPrice, homeBtcUsd, homeEthereumPrice, homeUnitTotal, homeUsd } from './home-prices';
import { homeAmount, homeIconButton, homeVerticalDivider } from './home-controls';
import { homeCopyKind, homeCopyRow, type HomeCopyKind } from './home-copy';
import { homeEthereumAddress } from './home-ethereum';
import { homeEvmBalances, type HomeEvmBalances } from './home-evm';
import { renderKeyOverrideContent, type KeyOverrideStatus } from './home-key-override';
import bitcoinIcon from './home-assets/bitcoin.svg';
import unitIcon from './home-assets/unit.svg';
import ethereumIcon from './home-assets/ethereum.svg';
import wrappedUnitIcon from './home-assets/wunit.svg';
import usdcIcon from './home-assets/usdc.svg';
import { renderCompactNetwork, renderNetworkMenu } from './home-network';
import { renderNetworkEndpointContent, type EndpointKind, type NetworkEndpointStatus } from './home-network-endpoints';
import { effectiveKeyOverride, getActiveAccountKeySet } from './key-overrides';
import { assertSelectedNetwork, getSelectedNetwork } from './network-selection';
import { effectiveNetworkProfile, networkProfile } from './network-profiles';
import { ducatAppUrl } from './networks';
import { getState } from './state';
import type { DeploymentId, DucatAccount, RecentAction } from './types';
import { getWalletInventory } from './wallet-inventory';
import {
  uiBanner,
  uiBox,
  uiButton,
  uiCard,
  uiHeading,
  uiSection,
  uiDivider,
  uiText,
  type SnapElement,
} from './ui';

export type HomeScreen = 'overview' | 'settings' | 'key' | EndpointKind;
type HomeViewOptions = {
  keyOverride?: KeyOverrideStatus;
  editingKey?: boolean;
  endpoints?: NetworkEndpointStatus;
  editingEndpoint?: EndpointKind | null;
  networkMenu?: boolean;
  expandedCopy?: HomeCopyKind | null;
  preserveDrafts?: boolean;
};

/**
 * Assembles the Snap home model from sanitized local state and effective network endpoints.
 * @param networkInput - Optional network identifier; defaults to the Snap-owned selection.
 * @param includeBalances - Skip remote reads for Settings.
 * @returns Public account data plus display-only balances, vault status, and recent actions.
 * @remarks Remote balances and vault data are informational and are not authoritative for signing policy.
 */
export async function getHomeState(networkInput: unknown, includeBalances = true): Promise<{
  network: DeploymentId;
  bitcoinUsdCents: bigint | null;
  ethereumUsdCents: bigint | null;
  appUrl: string;
  accounts: {
    sats: string;
    runes: string;
    vault: string | null;
    eth: string | null;
  };
  publicKeys: {
    sats: DucatAccount;
    runes: DucatAccount;
  };
  balances: HomeEvmBalances & {
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
  const eth = includeBalances ? await homeEthereumAddress() : null;
  const [inventory, bitcoinUsdCents, ethereumUsdCents, evm] = await Promise.all([
    includeBalances ? getWalletInventory(network).catch(() => null) : null,
    includeBalances ? homeBitcoinPrice() : null,
    includeBalances && eth ? homeEthereumPrice() : null,
    homeEvmBalances(network, eth),
  ]);

  return {
    network,
    bitcoinUsdCents,
    ethereumUsdCents,
    appUrl: ducatAppUrl(state.lastOrigin),
    accounts: {
      sats: keySet.record.sats.address,
      runes: keySet.record.runes.address,
      vault: vaultAccount?.address ?? null,
      eth,
    },
    publicKeys: {
      sats: keySet.record.sats,
      runes: keySet.record.runes,
    },
    balances: {
      ...evm,
      btcSats: inventory?.balances.btcSats ?? null,
      unitActive: inventory?.balances.unitActive ?? null,
      unitReserved: inventory?.balances.unitReserved ?? null,
      unitMixedActive: inventory?.balances.unitMixedActive ?? null,
      unitMixedReserved: inventory?.balances.unitMixedReserved ?? null,
    },
    recentActions: state.recentActions,
  };
}

function assetRow(label: string, value: string, extra?: string, image?: string): SnapElement {
  return uiBox([
    uiBox([...(image ? [Image({ src: image, alt: label, width: 32, height: 32, borderRadius: 'full' })] : []), uiText(label)], { direction: 'horizontal', crossAlignment: 'center' }),
    uiBox([
      uiText(value, { alignment: 'end' }),
      ...(extra ? [uiText(extra, { color: 'alternative', size: 'sm', alignment: 'end' })] : []),
    ]),
  ], { direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center' });
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
  statuses: HomeViewOptions = {},
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
  statuses: HomeViewOptions = {},
  screen: HomeScreen = 'overview',
): Promise<{ ui: SnapElement; context: Record<string, unknown> }> {
  try {
    const homeState = await getHomeState(networkInput, screen === 'overview');
    const state = await getState();
    const override = effectiveKeyOverride(state.keyOverrides ?? [], homeState.network);
    const profile = effectiveNetworkProfile(homeState.network, state.networkEndpointOverrides ?? {});
    const defaultProfile = networkProfile(homeState.network);
    const effective = override
      ? { source: 'imported' as const, sats: override.sats, runes: override.runes }
      : { source: 'derived' as const, sats: homeState.publicKeys.sats, runes: homeState.publicKeys.runes };

    const header = uiBox([
      renderCompactNetwork(homeState.network, statuses.networkMenu),
      homeIconButton('home-settings', 'setting'),
    ], { direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center' });

    if (screen === 'settings' || screen === 'key') {
      return {
        context: {
          screen: 'settings', network: homeState.network, networkMenu: statuses.networkMenu ?? false,
          expandedCopy: statuses.expandedCopy ?? null, editingKey: statuses.editingKey ?? screen === 'key',
          editingEndpoint: statuses.editingEndpoint ?? null,
        },
        ui: Container({ backgroundColor: 'default', children: uiBox([
          uiBox([uiHeading('Settings'), homeIconButton('home-close-settings', 'close')], { direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center' }),
          renderCompactNetwork(homeState.network, statuses.networkMenu),
          ...(statuses.networkMenu ? [renderNetworkMenu(homeState.network)] : []),
          uiDivider(),
          renderKeyOverrideContent({
            network: homeState.network, override, effective,
            status: statuses.keyOverride ?? null,
            editing: statuses.editingKey ?? screen === 'key',
            expandedCopy: statuses.expandedCopy === 'key',
          }),
          renderNetworkEndpointContent({
            network: homeState.network, profile, defaultProfile,
            editingEndpoint: statuses.editingEndpoint ?? null,
            status: statuses.endpoints ?? null, compact: true,
            expandedCopy: statuses.expandedCopy, preserveDraft: statuses.preserveDrafts,
          }),
        ]) }),
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

    const btcUsd = homeBtcUsd(homeState.balances.btcSats, homeState.bitcoinUsdCents);
    // UNIT's $1 reference is an estimate, including reserved and mixed outputs.
    const unitUsd = homeUnitTotal([homeState.balances.unitActive, homeState.balances.unitReserved, homeState.balances.unitMixedActive, homeState.balances.unitMixedReserved]);
    const ethUsd = homeAssetUsd(homeState.balances.ethWei, 18, homeState.ethereumUsdCents);
    const wunitUsd = homeAssetUsd(homeState.balances.wunit, 6, 100n);
    const usdcUsd = homeAssetUsd(homeState.balances.usdc, 6, 100n);
    const holdings = [btcUsd, unitUsd, ethUsd, usdcUsd, ...(homeState.balances.wunitConfigured ? [wunitUsd] : [])];
    const totalUsd = holdings.some(value => value === null) ? null : holdings.reduce<bigint>((sum, value) => sum + value!, 0n);
    const walletAddresses = [
      { label: 'BTC', kind: 'btc' as const, address: homeState.accounts.sats },
      { label: 'UNIT', kind: 'unit' as const, address: homeState.accounts.runes },
      { label: 'ETH', kind: 'eth' as const, address: homeState.accounts.eth },
    ];
    const expandedWallet = walletAddresses.find(wallet => wallet.kind === statuses.expandedCopy && wallet.address);

    return {
      context: { screen: 'home', network: homeState.network, networkMenu: statuses.networkMenu ?? false, expandedCopy: statuses.expandedCopy ?? null },
      ui: Container({ backgroundColor: 'default', children: uiBox([
        header,
        ...(statuses.networkMenu ? [renderNetworkMenu(homeState.network)] : []),
        expandedWallet?.address
          ? homeCopyRow(uiText(expandedWallet.label), expandedWallet.address, expandedWallet.kind, true)
          : uiBox(walletAddresses.flatMap((wallet, index) => [
            ...(index ? [homeVerticalDivider()] : []),
            wallet.address
              ? homeCopyRow(uiText(wallet.label), wallet.address, wallet.kind)
              : uiBox([uiText('ETH'), uiText('—', { color: 'alternative' })]),
          ]), { direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center' }),
        uiDivider(),
        uiBox([uiText('Estimated total', { color: 'alternative' }), uiHeading(homeUsd(totalUsd), 'md')], { direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center' }),
        assetRow('Bitcoin', homeUsd(btcUsd), homeAmount(homeState.balances.btcSats, 8, 'BTC'), bitcoinIcon),
        assetRow('UNIT', homeUsd(homeState.balances.unitActive === null ? null : BigInt(homeState.balances.unitActive)), homeAmount(homeState.balances.unitActive, 2, 'UNIT'), unitIcon),
        assetRow('ETH', homeUsd(ethUsd), homeAmount(homeState.balances.ethWei, 18, 'ETH', 6), ethereumIcon),
        assetRow('wUNIT', homeUsd(wunitUsd), homeState.balances.wunitConfigured ? homeAmount(homeState.balances.wunit, 6, 'wUNIT') : 'Available on Testnet', wrappedUnitIcon),
        assetRow('USDC', homeUsd(usdcUsd), homeAmount(homeState.balances.usdc, 6, 'USDC'), usdcIcon),
        ...(homeState.balances.unitReserved !== null && homeState.balances.unitReserved !== '0'
          ? [assetRow('Reserved', homeAmount(homeState.balances.unitReserved, 2, 'UNIT'))] : []),
        ...(homeState.balances.unitMixedActive !== null && homeState.balances.unitMixedReserved !== null &&
          (BigInt(homeState.balances.unitMixedActive) > 0n || BigInt(homeState.balances.unitMixedReserved) > 0n)
          ? [assetRow('Mixed outputs', homeAmount((BigInt(homeState.balances.unitMixedActive) + BigInt(homeState.balances.unitMixedReserved)).toString(), 2, 'UNIT'), 'Not included in available balance')] : []),
      ]) }),
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
  return homeCopyKind(name) !== null || name === 'home-settings' || name === 'home-close-settings' || name === 'manage-key' || name === 'cancel-edit-key' || name === 'manage-validator' || name === 'manage-esplora' || name === 'home-back';
}

export const handleHomeNavigationInput: OnUserInputHandler = async ({ id, event, context }) => {
  if (event.type !== UserInputEventType.ButtonClickEvent || !('name' in event) || typeof event.name !== 'string' || !isHomeNavigationEvent(event.name)) {
    return;
  }

  const { network } = await getSelectedNetwork();
  const copyKind = homeCopyKind(event.name);
  if (copyKind) {
    const screen = context?.screen === 'settings' || context?.screen === 'key' ? 'settings' : 'overview';
    if (context?.network !== network) {
      await updateHomeInterface(id, network, {}, screen);
      return;
    }
    const walletCopy = copyKind === 'btc' || copyKind === 'unit' || copyKind === 'eth';
    if (screen === 'settings' ? walletCopy : !walletCopy) return;
    await updateHomeInterface(id, network, {
      expandedCopy: context?.expandedCopy === copyKind ? null : copyKind,
      editingKey: context?.editingKey === true,
      editingEndpoint: context?.editingEndpoint === 'validator' || context?.editingEndpoint === 'esplora' ? context.editingEndpoint : null,
      networkMenu: context?.networkMenu === true,
      preserveDrafts: true,
    }, screen);
    return;
  }
  const screen: HomeScreen =
    event.name === 'home-settings' || event.name === 'home-back' || event.name === 'manage-key' || event.name === 'cancel-edit-key'
      ? 'settings'
      : event.name === 'manage-validator'
        ? 'validator'
        : event.name === 'manage-esplora'
          ? 'esplora'
          : 'overview';
  await updateHomeInterface(id, network, { editingKey: event.name === 'manage-key' }, screen);
};
