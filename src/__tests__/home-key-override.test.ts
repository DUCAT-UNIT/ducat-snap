jest.mock('../home-prices', () => ({ ...jest.requireActual('../home-prices'), homeBitcoinPrice: jest.fn(async () => null) }));
import { UserInputEventType } from '@metamask/snaps-sdk';
import { Buffer } from 'buffer';

jest.mock('../wallet-inventory', () => ({
  getWalletInventory: jest.fn(async () => {
    throw new Error('wallet inventory unavailable in Home key tests');
  }),
  invalidateWalletInventory: jest.fn(),
}));

import { getActiveAccountKeySet } from '../key-overrides';
import { p2trAccount, p2wpkhAccount, toXOnly } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { handleHomeUserInput, renderKeyOverrideContent } from '../home-key-override';
import type { DucatSnapState, PrivateKeyOverrideRecord } from '../types';
import { uiButton, uiField, uiForm, uiInput } from '../ui';

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

describe('Snap Home account UI helpers', () => {
  it('renders a password override form without labels or submitted key material', () => {
    const form = uiForm('import-private-key', [
      uiField('Bitcoin private key', uiInput('privateKey', 'password', 'WIF or 32-byte hex')),
      uiButton('Save override', { type: 'submit', name: 'import-private-key' }),
    ]);

    const json = rendered(form);
    expect(json).toContain('import-private-key');
    expect(json).toContain('password');
    expect(json).not.toContain('Account label');
    expect(json).not.toContain('"name":"label"');
    expect(json).not.toContain('private_key');
  });
});

function keyOverride(byte = 9): PrivateKeyOverrideRecord {
  const node = DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32));
  const publicKey = Buffer.from(node.publicKey);
  const sats = p2wpkhAccount('mutinynet', publicKey);
  const runes = p2trAccount('mutinynet', toXOnly(publicKey));

  return {
    id: 'imported-signet-1',
    source: 'imported',
    network: 'mutinynet',
    created_at: 1_700_000_000,
    fingerprint: `signet:${runes.address}`,
    private_key: Buffer.alloc(32, byte).toString('hex'),
    sats: { address: sats.address, pubkey: sats.pubkey },
    runes: { address: runes.address, pubkey: runes.pubkey },
  };
}

describe('Snap Home key override content', () => {
  it('shows a compact password editor without prefilled secret material', () => {
    const derived = keyOverride(4);
    const content = renderKeyOverrideContent({
      network: 'mutinynet',
      override: null,
      effective: {
        source: 'derived',
        sats: derived.sats,
        runes: derived.runes,
      },
      status: null,
      editing: true,
    });

    const json = rendered(content);
    expect(json).not.toContain('Bitcoin Master Key');
    expect(json).not.toContain('"type":"Section"');
    expect(json).not.toContain(derived.sats.pubkey);
    expect(json).not.toContain(derived.runes.pubkey);
    expect(json).toContain('Bitcoin private key');
    expect(json).toContain('cancel-edit-key');
    expect(json).toContain('"name":"check"');
    expect(json).toContain('password');
    expect(json).not.toContain('Account management');
    expect(json).not.toContain('Accounts');
    expect(json).not.toContain('Label');
    expect(json).not.toContain('Remove override');
  });

  it('copies the imported public key inline and offers restore only when editing', () => {
    const override = keyOverride();
    const content = renderKeyOverrideContent({
      network: 'mutinynet',
      override,
      effective: {
        source: 'imported',
        sats: override.sats,
        runes: override.runes,
      },
      status: null,
      expandedCopy: true,
    });

    const json = rendered(content);
    expect(json).toContain('Bitcoin public key');
    expect(json).toContain(override.sats.pubkey);
    expect(json).not.toContain('BTC public key');
    expect(json).not.toContain('UNIT public key');
    expect(json).toContain('Copyable');
    expect(json).toContain('manage-key');
    expect(json).not.toContain('password');
    expect(json).not.toContain('Restore MetaMask key');
    const editing = rendered(renderKeyOverrideContent({ network: 'mutinynet', override, effective: { source: 'imported', sats: override.sats, runes: override.runes }, status: null, editing: true }));
    expect(editing).toContain('Restore MetaMask key');
    expect(editing).toContain('password');
    expect(editing).not.toContain(override.private_key);
    expect(json).not.toContain('Account management');
    expect(json).not.toContain('Accounts');
    expect(json).not.toContain('Label');
    expect(json).not.toContain(override.private_key);
  });

  it('uses the imported override as the direct custody key instead of deriving child accounts', async () => {
    const override = keyOverride(9);
    const { request } = setSnapStateMock({ recentActions: [], keyOverrides: [override], selectedNetwork: 'mutinynet' });

    const keySet = await getActiveAccountKeySet('mutinynet');

    expect(keySet.source).toBe('imported');
    expect(keySet.record.sats.address).toBe(override.sats.address);
    expect(keySet.record.runes.address).toBe(override.runes.address);
    expect(request.mock.calls.some(([arg]) => arg.method === 'snap_getBip32Entropy')).toBe(false);
  });
});

function setSnapStateMock(initialState: DucatSnapState) {
  let managedState: DucatSnapState = initialState;
  const interfaces = new Map<string, unknown>();
  const request = jest.fn(async ({ method, params }: {
    method: string;
    params?: {
      id?: unknown;
      key?: keyof DucatSnapState;
      operation?: string;
      path?: string[];
      ui?: unknown;
      value?: unknown;
    };
  }) => {
    if (method === 'snap_manageState') {
      if (params?.operation === 'get') return managedState;
    }
    if (method === 'snap_setState' && params?.key) {
      managedState = { ...managedState, [params.key]: params.value };
      return null;
    }
    if (method === 'snap_getBip32Entropy') {
      const byte = params?.path?.[1] === "84'" ? 1 : 2;
      return {
        privateKey: Buffer.alloc(32, byte).toString('hex'),
        chainCode: Buffer.alloc(32, byte + 10).toString('hex'),
      };
    }
    if (method === 'snap_updateInterface') {
      interfaces.set(String(params?.id), params?.ui);
      return undefined;
    }
    throw new Error(`Unexpected Snap method ${method}`);
  });
  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };
  return { request, interfaces, state: () => managedState };
}

describe('Snap Home key override input handling', () => {
  it('does not let a stale Home form mutate another network', async () => {
    const override = keyOverride(9);
    const { interfaces, state } = setSnapStateMock({ recentActions: [], keyOverrides: [override], selectedNetwork: 'mutinynet' });

    await handleHomeUserInput({
      id: 'interface-1',
      context: { screen: 'key-override', network: 'regtest' },
      event: {
        type: UserInputEventType.FormSubmitEvent,
        name: 'import-private-key',
        value: { privateKey: '08'.repeat(32) },
      },
    });

    expect(state().selectedNetwork).toBe('mutinynet');
    expect(state().keyOverrides?.[0]?.private_key).toBe(override.private_key);
    expect(JSON.stringify(interfaces.get('interface-1'))).toContain('Testnet');
  });

  it('saves a private key override from Snap Home without labels and clears submitted key material from rendered UI', async () => {
    const oldOverride = keyOverride(8);
    const { interfaces, state } = setSnapStateMock({ recentActions: [], keyOverrides: [oldOverride], selectedNetwork: 'mutinynet' });

    await handleHomeUserInput({
      id: 'interface-1',
        context: { screen: 'key-override', network: 'mutinynet' },
      event: {
        type: UserInputEventType.FormSubmitEvent,
        name: 'import-private-key',
        value: {
          privateKey: '09'.repeat(32),
        },
      },
    });

    expect(state().keyOverrides).toHaveLength(1);
    expect(state().keyOverrides?.[0]?.private_key).toBe('09'.repeat(32));
    expect(state().keyOverrides?.[0]).not.toHaveProperty('label');
    expect(JSON.stringify(interfaces.get('interface-1'))).toContain('Override saved');
    expect(JSON.stringify(interfaces.get('interface-1'))).toContain('Settings');
    expect(JSON.stringify(interfaces.get('interface-1'))).not.toContain('"name":"privateKey"');
    expect(JSON.stringify(interfaces.get('interface-1'))).not.toContain('09090909');
    expect(JSON.stringify(interfaces.get('interface-1'))).not.toContain('Label');
  });

  it('removes the imported override from Snap Home and restores derived account state', async () => {
    const override = keyOverride(9);
    const { state } = setSnapStateMock({ recentActions: [], keyOverrides: [override], selectedNetwork: 'mutinynet' });

    await handleHomeUserInput({
      id: 'interface-1',
        context: { screen: 'key-override', network: 'mutinynet' },
      event: {
        type: UserInputEventType.FormSubmitEvent,
        name: `remove-override:${override.id}`,
        value: {},
      },
    });

    expect(state().keyOverrides).toEqual([]);
  });
});
