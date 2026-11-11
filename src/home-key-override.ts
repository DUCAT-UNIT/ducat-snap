/** @fileoverview Handles Home forms for network key overrides without redisplaying imported secret material. */
import { UserInputEventType, type OnUserInputHandler } from '@metamask/snaps-sdk';

import { updateHomeInterface } from './home';
import { homeIconButton, homeSettingTitle, homeVerticalDivider } from './home-controls';
import { homeCopyRow } from './home-copy';
import { importPrivateKeyFromSnapHome, removeKeyOverrideFromSnapHome } from './key-overrides';
import { getSelectedNetwork } from './network-selection';
import { normalizeDeploymentId } from './networks';
import type { DeploymentId, DucatAccount, PrivateKeyOverrideRecord } from './types';
import { invalidateWalletInventory } from './wallet-inventory';
import {
  uiBanner,
  uiBox,
  uiButton,
  uiField,
  uiForm,
  uiInput,
  uiText,
  type SnapElement,
} from './ui';

export type KeyOverrideStatus =
  | { severity: 'success' | 'warning' | 'danger' | 'info'; title: string; message: string }
  | null;

export function renderKeyOverrideContent(params: {
  network: DeploymentId;
  override: PrivateKeyOverrideRecord | null;
  effective: {
    source: 'derived' | 'imported';
    sats: DucatAccount;
    runes: DucatAccount;
  };
  status: KeyOverrideStatus;
  editing?: boolean;
  expandedCopy?: boolean;
}): SnapElement {
  return uiBox([
    ...(params.status ? [uiBanner(params.status.title, params.status.severity, params.status.message)] : []),
    ...(params.editing ? [
      uiForm('import-private-key', [
        homeSettingTitle('Bitcoin private key', 'cancel-edit-key', true),
        uiText('Import a private key to change the account on this network.', { size: 'sm', color: 'alternative' }),
        uiBox([
          uiField('', uiInput('privateKey', 'password', params.override ? 'Replacement WIF or 32-byte hex' : 'WIF or 32-byte hex')),
          homeVerticalDivider(28),
          homeIconButton('import-private-key', 'check', 'submit'),
        ], { direction: 'horizontal', crossAlignment: 'center', alignment: 'space-between' }),
      ]),
      ...(params.override ? [uiForm(`remove-override:${params.override.id}`, [
        uiButton('Restore MetaMask key', { name: `remove-override:${params.override.id}`, type: 'submit' }),
      ])] : []),
    ] : [
      homeCopyRow(homeSettingTitle('Bitcoin public key', 'manage-key'), params.effective.sats.pubkey, 'key', params.expandedCopy),
    ]),
  ]);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function updateKeyOverrideInterface(id: string, network: DeploymentId, status: KeyOverrideStatus): Promise<void> {
  await updateHomeInterface(id, network, { keyOverride: status, editingKey: status?.severity === 'danger' }, 'settings');
}

export const handleHomeUserInput: OnUserInputHandler = async ({ id, context, event }) => {
  const network = normalizeDeploymentId(typeof context?.network === 'string' ? context.network : 'mutinynet');

  if (event.type !== UserInputEventType.FormSubmitEvent) {
    return;
  }

  const selected = await getSelectedNetwork();
  if (network !== selected.network) {
    await updateHomeInterface(id, selected.network);
    return;
  }

  try {
    if (event.name === 'import-private-key') {
      await importPrivateKeyFromSnapHome({
        network,
        privateKey: stringField(event.value.privateKey),
      });
      invalidateWalletInventory(network);
      await updateKeyOverrideInterface(id, network, {
        severity: 'success',
        title: 'Override saved',
        message: 'The imported key now overrides the MetaMask-derived account for this network.',
      });
      return;
    }

    if (event.name.startsWith('remove-override:')) {
      const accountId = event.name.slice('remove-override:'.length);
      await removeKeyOverrideFromSnapHome({ network, accountId });
      invalidateWalletInventory(network);
      await updateKeyOverrideInterface(id, network, {
        severity: 'success',
        title: 'Override removed',
        message: 'The imported key was removed. The MetaMask-derived account is active again.',
      });
    }
  } catch (error) {
    await updateKeyOverrideInterface(id, network, {
      severity: 'danger',
      title: 'Override update failed',
      message: error instanceof Error ? error.message : String(error),
    });
    throw error instanceof Error ? error : new Error(String(error));
  }
};
