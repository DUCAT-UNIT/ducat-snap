/** @fileoverview Renders and persists validated per-network validator and Esplora endpoint overrides. */
import { UserInputEventType, type OnUserInputHandler } from '@metamask/snaps-sdk';

import {
  effectiveNetworkProfile,
  normalizeNetworkEndpointUrl,
  type DeploymentProfile,
} from './network-profiles';
import { verifyDeploymentEndpointIdentity, type EndpointKind } from './network-endpoint-policy';
import { updateHomeInterface } from './home';
import { getSelectedNetwork } from './network-selection';
import { normalizeDeploymentId } from './networks';
import { getState, updateStateField } from './state';
import type { DeploymentId, NetworkEndpointOverride, NetworkEndpointOverrides } from './types';
import { invalidateWalletInventory } from './wallet-inventory';
import {
  uiBanner,
  uiButton,
  uiCopyable,
  uiField,
  uiForm,
  uiHeading,
  uiInput,
  uiRow,
  uiSection,
  type SnapElement,
} from './ui';

export type { EndpointKind } from './network-endpoint-policy';

export type NetworkEndpointStatus =
  | { severity: 'success' | 'warning' | 'danger' | 'info'; title: string; message: string }
  | null;

export function isEndpointOverrideEvent(name: string): boolean {
  return /^(?:save-endpoint|edit-endpoint|clear-endpoint|cancel-edit-endpoint):(?:validator|esplora)$/u.test(name);
}

export function renderNetworkEndpointContent(params: {
  network: DeploymentId;
  profile: DeploymentProfile;
  defaultProfile: DeploymentProfile;
  editingEndpoint: EndpointKind | null;
  endpoint?: EndpointKind;
  status: NetworkEndpointStatus;
}): SnapElement {
  const endpoints: EndpointKind[] = params.endpoint ? [params.endpoint] : ['validator', 'esplora'];

  return uiSection([
    uiHeading(params.endpoint ? `Manage ${endpointLabel(params.endpoint)}` : 'Network endpoints'),
    ...(params.status ? [uiBanner(params.status.title, params.status.severity, params.status.message)] : []),
    ...endpoints.flatMap((endpoint) => endpointRows(params, endpoint)),
  ]);
}

function endpointLabel(kind: EndpointKind): string {
  return kind === 'validator' ? 'Validator' : 'Esplora';
}

type EndpointUrlField = 'validator_base_url' | 'esplora_base_url';

function endpointField(kind: EndpointKind): EndpointUrlField {
  return kind === 'validator' ? 'validator_base_url' : 'esplora_base_url';
}

function endpointUrl(profile: DeploymentProfile, kind: EndpointKind): string {
  return kind === 'validator' ? profile.validator_base_url : profile.esplora_base_url;
}

function endpointRows(params: {
  profile: DeploymentProfile;
  defaultProfile: DeploymentProfile;
  editingEndpoint: EndpointKind | null;
}, kind: EndpointKind): SnapElement[] {
  const label = endpointLabel(kind);
  const currentUrl = endpointUrl(params.profile, kind);
  const defaultUrl = endpointUrl(params.defaultProfile, kind);
  const isOverride = currentUrl !== defaultUrl;

  if (params.editingEndpoint === kind) {
    return [
      uiForm(`save-endpoint:${kind}`, [
        uiField(`${label} URL`, uiInput('endpointUrl', 'text', currentUrl)),
        uiButton(`Save ${label}`, { type: 'submit', name: `save-endpoint:${kind}` }),
      ]),
      uiButton('Cancel', { name: `cancel-edit-endpoint:${kind}` }),
    ];
  }

  return [
    uiRow(label, uiCopyable(currentUrl), isOverride ? 'warning' : 'default'),
    uiButton(`Edit ${label}`, { name: `edit-endpoint:${kind}` }),
    uiButton(`Clear ${label}`, { name: `clear-endpoint:${kind}`, variant: isOverride ? 'destructive' : undefined }),
  ];
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function endpointOverridesWithNetwork(
  overrides: NetworkEndpointOverrides | undefined,
  network: DeploymentId,
  override: NetworkEndpointOverride | null,
): NetworkEndpointOverrides {
  const current: NetworkEndpointOverrides = { ...(overrides ?? {}) };
  if (override && (override.validator_base_url || override.esplora_base_url)) {
    current[network] = override;
  } else {
    delete current[network];
  }

  return current;
}

function endpointOverrideWithField(
  current: NetworkEndpointOverride | null | undefined,
  kind: EndpointKind,
  url: string | null,
): NetworkEndpointOverride | null {
  const override: NetworkEndpointOverride = { ...(current ?? {}) };
  const field = endpointField(kind);

  if (url) {
    override[field] = url;
    override.network_identity_verified = true;
  } else {
    delete override[field];
  }

  if (!override.validator_base_url && !override.esplora_base_url) return null;
  return override;
}

async function saveEndpointOverride(network: DeploymentId, kind: EndpointKind, url: string | null): Promise<void> {
  await updateStateField('networkEndpointOverrides', (state) => {
    const override = endpointOverrideWithField(state.networkEndpointOverrides?.[network], kind, url);
    return endpointOverridesWithNetwork(state.networkEndpointOverrides, network, override);
  });
}

async function updateEndpointInterface(
  id: string,
  network: DeploymentId,
  status: NetworkEndpointStatus,
  screenEndpoint: EndpointKind,
  editingEndpoint: EndpointKind | null = null,
): Promise<void> {
  await updateHomeInterface(id, network, { endpoints: status, editingEndpoint }, screenEndpoint);
}

export const handleEndpointOverrideInput: OnUserInputHandler = async ({ id, context, event }) => {
  const network = normalizeDeploymentId(typeof context?.network === 'string' ? context.network : 'mutinynet');

  if (!('name' in event) || typeof event.name !== 'string' || !isEndpointOverrideEvent(event.name)) {
    return;
  }

  const selected = await getSelectedNetwork();
  if (network !== selected.network) {
    await updateHomeInterface(id, selected.network);
    return;
  }

  const [, fallbackEndpoint] = event.name.split(':') as [string, EndpointKind];

  try {
    const [action, endpointInput] = event.name.split(':') as [string, EndpointKind];

    if (action === 'edit-endpoint') {
      await updateEndpointInterface(id, network, null, endpointInput, endpointInput);
      return;
    }

    if (action === 'cancel-edit-endpoint') {
      await updateHomeInterface(id, network, { endpoints: null, editingEndpoint: null }, endpointInput);
      return;
    }

    const state = await getState();

    if (action === 'clear-endpoint') {
      await saveEndpointOverride(network, endpointInput, null);
      invalidateWalletInventory(network);
      await updateEndpointInterface(id, network, {
        severity: 'success',
        title: `${endpointLabel(endpointInput)} endpoint cleared`,
        message: 'The bundled Ducat network endpoint is active again.',
      }, endpointInput);
      return;
    }

    if (event.type !== UserInputEventType.FormSubmitEvent || action !== 'save-endpoint') {
      return;
    }

    const profile = effectiveNetworkProfile(network, state.networkEndpointOverrides ?? {});
    const endpointUrl = normalizeNetworkEndpointUrl(
      stringField(event.value.endpointUrl),
      endpointField(endpointInput),
      profile.bitcoin_network,
    );
    await verifyDeploymentEndpointIdentity(
      profile.expected_validator_chain_network,
      profile.bitcoin_network,
      endpointInput,
      endpointUrl,
    );
    await saveEndpointOverride(network, endpointInput, endpointUrl);
    invalidateWalletInventory(network);
    await updateEndpointInterface(id, network, {
      severity: 'success',
      title: `${endpointLabel(endpointInput)} endpoint saved`,
      message: 'The Snap will use this endpoint for this network until it is cleared.',
    }, endpointInput);
  } catch (error) {
    await updateEndpointInterface(id, network, {
      severity: 'danger',
      title: 'Endpoint update failed',
      message: error instanceof Error ? error.message : String(error),
    }, fallbackEndpoint);
    throw error instanceof Error ? error : new Error(String(error));
  }
};
