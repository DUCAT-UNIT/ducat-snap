/** @fileoverview Handles Home forms for network key overrides without redisplaying imported secret material. */
import { UserInputEventType, type InterfaceContext, type OnUserInputHandler } from '@metamask/snaps-sdk';

import { updateHomeInterface } from './home';
import { importPrivateKeyFromSnapHome, removeKeyOverrideFromSnapHome } from './key-overrides';
import { getSelectedNetwork } from './network-selection';
import { normalizeNetwork } from './networks';
import type { DucatAccount, DucatNetwork, PrivateKeyOverrideRecord } from './types';
import { invalidateWalletInventory } from './wallet-inventory';
import {
  uiBanner,
  uiBox,
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

export type KeyOverrideStatus =
  | { severity: 'success' | 'warning' | 'danger' | 'info'; title: string; message: string }
  | null;

export type KeyOverrideContext = InterfaceContext & {
  screen?: 'key-override';
  network?: DucatNetwork;
};

export function renderKeyOverrideContent(params: {
  network: DucatNetwork;
  override: PrivateKeyOverrideRecord | null;
  effective: {
    source: 'derived' | 'imported';
    sats: DucatAccount;
    runes: DucatAccount;
  };
  status: KeyOverrideStatus;
}): SnapElement {
  const sourceLabel = params.effective.source === 'imported' ? 'Imported' : 'Internal';

  return uiBox([
    uiSection([
      uiHeading('Bitcoin Master Key'),
      ...(params.status ? [uiBanner(params.status.title, params.status.severity, params.status.message)] : []),
      uiRow('Source', sourceLabel),
      ...(params.effective.source === 'imported'
        ? [uiRow('Public key', uiCopyable(params.effective.sats.pubkey))]
        : []),
      ...(params.override
        ? [
            uiForm('import-private-key', [
              uiField('Bitcoin private key', uiInput('privateKey', 'password', 'Replacement WIF or 32-byte hex')),
              uiButton('Update override', { type: 'submit', name: 'import-private-key' }),
            ]),
            uiForm(`remove-override:${params.override.id}`, [
              uiButton('Remove override', {
                name: `remove-override:${params.override.id}`,
                type: 'submit',
                variant: 'destructive',
              }),
            ]),
          ]
        : [
            uiForm('import-private-key', [
              uiField('Bitcoin private key', uiInput('privateKey', 'password', 'WIF or 32-byte hex')),
              uiButton('Save override', { type: 'submit', name: 'import-private-key' }),
            ]),
          ]),
    ]),
  ]);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function updateKeyOverrideInterface(id: string, network: DucatNetwork, status: KeyOverrideStatus): Promise<void> {
  await updateHomeInterface(id, network, { keyOverride: status }, 'key');
}

export const handleHomeUserInput: OnUserInputHandler = async ({ id, context, event }) => {
  const network = normalizeNetwork(typeof context?.network === 'string' ? context.network : 'mutinynet');

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
