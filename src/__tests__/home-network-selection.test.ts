import { UserInputEventType } from '@metamask/snaps-sdk';
import { Buffer } from 'buffer';

jest.mock('../wallet-inventory', () => ({
  getWalletInventory: jest.fn(async () => {
    throw new Error('wallet inventory unavailable in Home navigation tests');
  }),
  invalidateWalletInventory: jest.fn(),
}));

import { handleHomeNavigationInput } from '../home';
import { handleHomeNetworkInput, renderNetworkSelector } from '../home-network';
import type { DucatSnapState } from '../types';

type SnapRequestArgs = {
  method: string;
  params?: {
    context?: unknown;
    id?: unknown;
    key?: keyof DucatSnapState;
    operation?: string;
    path?: string[];
    ui?: unknown;
    value?: unknown;
  };
};

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

function setSnapStateMock(initialState: DucatSnapState, dialogResult = true) {
  let managedState: DucatSnapState = initialState;
  const interfaces = new Map<string, unknown>();
  const request = jest.fn(async ({ method, params }: SnapRequestArgs) => {
    if (method === 'snap_manageState') {
      if (params?.operation === 'get') return managedState;
    }
    if (method === 'snap_setState' && params?.key) {
      managedState = { ...managedState, [params.key]: params.value } as DucatSnapState;
      return null;
    }
    if (method === 'snap_getBip32Entropy') {
      const byte = params?.path?.[1] === "84'" ? 1 : 2;
      return {
        privateKey: Buffer.alloc(32, byte).toString('hex'),
        chainCode: Buffer.alloc(32, byte + 10).toString('hex'),
      };
    }
    if (method === 'snap_dialog') {
      return dialogResult;
    }
    if (method === 'snap_updateInterface') {
      interfaces.set(String(params?.id), params?.ui);
      return undefined;
    }
    throw new Error(`Unexpected Snap method ${method}`);
  });
  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };
  return { interfaces, state: () => managedState };
}

describe('Snap Home network selector', () => {
  it('renders a network dropdown with the current network selected', () => {
    const selector = renderNetworkSelector('signet');
    const json = rendered(selector);

    expect(json).toContain('Network');
    expect(json).toContain('"name":"homeNetwork"');
    expect(json).toContain('"value":"signet"');
    expect(json).not.toContain('regtest');
    expect(json).toContain('signet');
    expect(json).toContain('mutinynet');
    expect(json).toContain('testnet4');
    expect(json).toContain('mainnet');
    expect(json).not.toContain('Signet testnet');
    expect(json).not.toContain('Mutinynet / Signet testnet');
  });

  it('opens the Bitcoin key management screen from the overview', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'signet' });

    await handleHomeNavigationInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'signet' },
      event: {
        type: UserInputEventType.ButtonClickEvent,
        name: 'manage-key',
      },
    });

    const json = rendered(interfaces.get('interface-1'));
    expect(json).toContain('Bitcoin Master Key');
    expect(json).toContain('Bitcoin private key');
    expect(json).toContain('Back');
    expect(json).not.toContain('Network endpoints');
  });

  it('opens endpoint-specific management screens from the overview', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'signet' });

    await handleHomeNavigationInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'signet' },
      event: {
        type: UserInputEventType.ButtonClickEvent,
        name: 'manage-validator',
      },
    });

    const validatorJson = rendered(interfaces.get('interface-1'));
    expect(validatorJson).toContain('Manage Validator');
    expect(validatorJson).toContain('Edit Validator');
    expect(validatorJson).toContain('Clear Validator');
    expect(validatorJson).not.toContain('Edit Esplora');

    await handleHomeNavigationInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'signet' },
      event: {
        type: UserInputEventType.ButtonClickEvent,
        name: 'manage-esplora',
      },
    });

    const esploraJson = rendered(interfaces.get('interface-1'));
    expect(esploraJson).toContain('Manage Esplora');
    expect(esploraJson).toContain('Edit Esplora');
    expect(esploraJson).toContain('Clear Esplora');
    expect(esploraJson).not.toContain('Edit Validator');
  });

  it('persists the selected network and refreshes the Home interface', async () => {
    const { interfaces, state } = setSnapStateMock({ recentActions: [], selectedNetwork: 'signet' });

    await handleHomeNetworkInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'signet' },
      event: {
        type: UserInputEventType.InputChangeEvent,
        name: 'homeNetwork',
        value: 'mutinynet',
      },
    });

    expect(state().selectedNetwork).toBe('mutinynet');
    expect(rendered(interfaces.get('interface-1'))).toContain('mutinynet');
  });

  it('reverts the Home dropdown when the confirmation is rejected', async () => {
    const { interfaces, state } = setSnapStateMock({ recentActions: [], selectedNetwork: 'signet' }, false);

    await handleHomeNetworkInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'signet' },
      event: {
        type: UserInputEventType.InputChangeEvent,
        name: 'homeNetwork',
        value: 'mutinynet',
      },
    });

    expect(state().selectedNetwork).toBe('signet');
    expect(rendered(interfaces.get('interface-1'))).toContain('signet');
  });
});
