/** @fileoverview Renders the Home network selector and persists valid network changes before refresh. */
import { UserInputEventType, type OnUserInputHandler } from '@metamask/snaps-sdk';

import { updateHomeInterface } from './home';
import { getSelectedNetwork, requestNetworkSwitch } from './network-selection';
import { networkProfiles } from './network-profiles';
import { normalizeNetwork } from './networks';
import type { DucatNetwork } from './types';
import {
  uiDropdown,
  uiField,
  type SnapElement,
} from './ui';

export function renderNetworkSelector(network: DucatNetwork): SnapElement {
  return uiField(
    'Network',
    uiDropdown(
      'homeNetwork',
      network,
      networkProfiles().map((profile) => ({
        label: profile.label,
        value: profile.id,
      })),
    ),
  );
}

export function isHomeNetworkEvent(name: string): boolean {
  return name === 'homeNetwork';
}

export const handleHomeNetworkInput: OnUserInputHandler = async ({ id, event }) => {
  if (event.type !== UserInputEventType.InputChangeEvent || event.name !== 'homeNetwork') {
    return;
  }

  const previous = await getSelectedNetwork();
  const network = normalizeNetwork(event.value);

  try {
    const result = await requestNetworkSwitch({ network }, 'Ducat Snap Home');
    await updateHomeInterface(id, result.network);
  } catch {
    await updateHomeInterface(id, previous.network);
  }
};
