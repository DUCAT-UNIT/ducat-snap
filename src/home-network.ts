/** @fileoverview Renders the Home network selector and persists valid network changes before refresh. */
import { Button, Image } from '@metamask/snaps-sdk/jsx';
import { UserInputEventType, type OnUserInputHandler } from '@metamask/snaps-sdk';

import { homeIconButton } from './home-controls';
import { uiBox, uiText } from './ui';
import { updateHomeInterface } from './home';
import { getSelectedNetwork, requestNetworkSwitch } from './network-selection';
import { networkProfiles } from './network-profiles';
import { normalizeDeploymentId } from './networks';
import type { DeploymentId } from './types';
import {
  uiDropdown,
  uiField,
  type SnapElement,
} from './ui';

export function renderNetworkSelector(network: DeploymentId, compact = false): SnapElement {
  const dropdown = uiDropdown('homeNetwork', network, networkProfiles().map((profile) => ({
    label: compact ? (profile.id === 'mutinynet' ? 'Testnet' : profile.id === 'mainnet' ? 'Mainnet' : 'Regtest') : profile.label,
    value: profile.id,
  })));
  return compact ? dropdown : uiField('Network', dropdown);
}

export function renderCompactNetwork(network: DeploymentId, expanded = false): SnapElement {
  return uiBox([
    uiText(network === 'mutinynet' ? 'Testnet' : network === 'mainnet' ? 'Mainnet' : 'Regtest', { color: 'alternative' }),
    homeIconButton('home-network-toggle', expanded ? 'arrow-up' : 'arrow-down'),
  ], { direction: 'horizontal', crossAlignment: 'center' });
}

/** Image-backed native buttons keep the menu labels neutral and the whole row clickable. */
export function renderNetworkMenu(network: DeploymentId): SnapElement {
  return uiBox(networkProfiles().map((profile) => {
    const label = profile.id === 'mutinynet' ? 'Testnet' : profile.id === 'mainnet' ? 'Mainnet' : 'Regtest';
    const selected = profile.id === network;
    const src = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="36" viewBox="0 0 180 36"><text x="0" y="24" fill="#f5f5f7" font-family="Arial,sans-serif" font-size="16">${label}</text>${selected ? '<path d="m151 18 4 4 8-9" fill="none" stroke="#c3c1d5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' : ''}</svg>`;
    return Button({ name: `home-network-${profile.id}`, children: Image({ src, alt: `${label}${selected ? ' (selected)' : ''}`, width: 180, height: 36 }) });
  }));
}

export function isHomeNetworkEvent(name: string): boolean {
  return name === 'homeNetwork' || name === 'home-network-toggle' || /^home-network-(mutinynet|mainnet|regtest)$/u.test(name);
}

export const handleHomeNetworkInput: OnUserInputHandler = async ({ id, event, context }) => {
  const screen = context?.screen === 'settings' ? 'settings' : 'overview';
  if (event.type === UserInputEventType.ButtonClickEvent && event.name === 'home-network-toggle') {
    const selected = await getSelectedNetwork();
    await updateHomeInterface(id, selected.network, { networkMenu: !context?.networkMenu }, screen);
    return;
  }
  const dropdownChange = event.type === UserInputEventType.InputChangeEvent && event.name === 'homeNetwork';
  const menuSelection = event.type === UserInputEventType.ButtonClickEvent && /^home-network-(mutinynet|mainnet|regtest)$/u.test(event.name ?? '');
  if (!dropdownChange && !menuSelection) return;

  const previous = await getSelectedNetwork();
  const network = normalizeDeploymentId(dropdownChange ? event.value : event.name!.slice('home-network-'.length));

  try {
    const result = await requestNetworkSwitch({ network }, 'Ducat Snap Home');
    await updateHomeInterface(id, result.network, {}, screen);
  } catch {
    await updateHomeInterface(id, previous.network, {}, screen);
  }
};
