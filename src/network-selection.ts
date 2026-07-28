/** @fileoverview Owns explicit Ducat network selection, mismatch policy, and confirmed switching. */
import { networkLabel } from './display';
import { ducatError } from './errors';
import { effectiveNetworkProfile } from './network-profiles';
import { normalizeNetwork } from './networks';
import { getState, setSelectedNetwork } from './state';
import type { DucatNetwork } from './types';
import { invalidateWalletInventory } from './wallet-inventory';
import { uiBanner, uiBox, uiHeading, uiRow, uiSection } from './ui';

export type NetworkResponse = {
  network: DucatNetwork;
  label: string;
};

export type NetworkSwitchResponse = {
  network: DucatNetwork;
  changed: boolean;
};

function endpointOrigin(value: string): string {
  return new URL(value).origin;
}

function parseSwitchParams(value: unknown): DucatNetwork {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ducatError('INVALID_PARAMS', 'ducat_switchNetwork requires exactly one network parameter.');
  }

  const params = value as Record<string, unknown>;
  const keys = Object.keys(params);
  if (keys.length !== 1 || keys[0] !== 'network') {
    throw ducatError('INVALID_PARAMS', 'ducat_switchNetwork accepts only the network parameter.');
  }

  return normalizeNetwork(params.network);
}

/** @returns The current Snap-owned network selection and display label. */
export async function getSelectedNetwork(): Promise<NetworkResponse> {
  const state = await getState();
  return { network: state.selectedNetwork, label: networkLabel(state.selectedNetwork) };
}

/**
 * Rejects a requested network unless it exactly matches the Snap-owned selection.
 * @param networkInput - Untrusted request network.
 * @returns The normalized exact-match network.
 */
export async function assertSelectedNetwork(networkInput: unknown): Promise<DucatNetwork> {
  const requestedNetwork = normalizeNetwork(networkInput);
  const { selectedNetwork } = await getState();

  if (requestedNetwork !== selectedNetwork) {
    throw ducatError(
      'NETWORK_MISMATCH',
      `Ducat Snap is set to ${selectedNetwork}. Request an explicit switch to ${requestedNetwork} before continuing.`,
      { selectedNetwork, requestedNetwork },
    );
  }

  return requestedNetwork;
}

/**
 * Requests one MetaMask-owned confirmation and persists the target only after approval.
 * @param paramsInput - Exact public switch parameters.
 * @param requestingOrigin - Authorized website origin or the Snap Home label.
 * @returns The selected canonical network and whether it changed.
 */
export async function requestNetworkSwitch(
  paramsInput: unknown,
  requestingOrigin: string,
): Promise<NetworkSwitchResponse> {
  const network = parseSwitchParams(paramsInput);
  const state = await getState();

  if (network === state.selectedNetwork) {
    return { network, changed: false };
  }

  const profile = effectiveNetworkProfile(network, state.networkEndpointOverrides ?? {});
  const isMainnet = network === 'mainnet';
  const approved = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiHeading('Switch Ducat network', 'lg'),
        uiSection([
          uiRow('Requesting origin', requestingOrigin),
          uiRow('From', networkLabel(state.selectedNetwork)),
          uiRow('To', profile.label),
          uiRow('Validator', endpointOrigin(profile.validator_base_url)),
          uiRow('Esplora', endpointOrigin(profile.esplora_base_url)),
        ]),
        uiBanner(
          isMainnet ? 'Real BTC warning' : 'Signing context changes',
          isMainnet ? 'danger' : 'warning',
          isMainnet
            ? 'This switches Ducat to Bitcoin mainnet. Real BTC may be spent. Accounts, addresses, balances, imported network key, endpoints, and signing context will change.'
            : 'Bitcoin accounts, addresses, balances, imported network key, endpoint selection, and signing context will change.',
        ),
      ]),
    },
  });

  if (!approved) {
    throw ducatError('USER_REJECTED', 'The Ducat network switch was rejected.', {
      selectedNetwork: state.selectedNetwork,
      requestedNetwork: network,
    });
  }

  await setSelectedNetwork(network);
  invalidateWalletInventory();
  return { network, changed: true };
}
