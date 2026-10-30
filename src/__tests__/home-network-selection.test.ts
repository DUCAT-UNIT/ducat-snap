jest.mock('../home-prices', () => ({ ...jest.requireActual('../home-prices'), homeBitcoinPrice: jest.fn(async () => null), homeEthereumPrice: jest.fn(async () => null) }));
jest.mock('../home-evm', () => ({ homeEvmBalances: jest.fn(async () => ({ ethWei: null, wunit: null, usdc: null, wunitConfigured: true })) }));
import { UserInputEventType } from '@metamask/snaps-sdk';
import { Buffer } from 'buffer';

jest.mock('../wallet-inventory', () => ({
  getWalletInventory: jest.fn(async () => {
    throw new Error('wallet inventory unavailable in Home navigation tests');
  }),
  invalidateWalletInventory: jest.fn(),
}));

import { assertJSXElement } from '@metamask/snaps-sdk/jsx';
import { homeAmount } from '../home-controls';
import { homeEvmBalances } from '../home-evm';
import { homeBitcoinPrice, homeEthereumPrice } from '../home-prices';
import { getWalletInventory } from '../wallet-inventory';
import { getHomeState, handleHomeNavigationInput, updateHomeInterface } from '../home';
import { onHomePage } from '../index';
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

function nodes(element: any, type: string): any[] {
  if (!element || typeof element !== 'object') return [];
  return [...(element.type === type ? [element] : []), ...Object.values(element).flatMap(value => Array.isArray(value) ? value.flatMap(child => nodes(child, type)) : nodes(value, type))];
}

function setSnapStateMock(initialState: DucatSnapState, dialogResult = true) {
  let managedState: DucatSnapState = initialState;
  const interfaces = new Map<string, unknown>();
  const contexts = new Map<string, any>();
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
    if (method === 'snap_updateInterface' || method === 'snap_createInterface') {
      assertJSXElement(params?.ui);
      const id = String(params?.id ?? 'home');
      interfaces.set(id, params?.ui);
      contexts.set(id, params?.context);
      return method === 'snap_createInterface' ? id : undefined;
    }
    throw new Error(`Unexpected Snap method ${method}`);
  });
  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };
  return { interfaces, contexts, request, state: () => managedState };
}

describe('Snap Home network selector', () => {
  it('renders a network dropdown with the current network selected', () => {
    const selector = renderNetworkSelector('mutinynet');
    const json = rendered(selector);

    expect(json).toContain('Network');
    expect(json).toContain('"name":"homeNetwork"');
    expect(json).toContain('"value":"mutinynet"');
    expect(json).not.toContain('regtest');
    expect(json).toContain('mutinynet');
    expect(json).toContain('mainnet');
    expect(json).not.toContain('signet');
    expect(json).not.toContain('testnet4');
    expect(json).not.toContain('Signet testnet');
    expect(json).not.toContain('Mutinynet / Signet testnet');
  });

  it('edits the Bitcoin key inline and cancels back to the public key without leaving Settings', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });

    await handleHomeNavigationInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'mutinynet' },
      event: {
        type: UserInputEventType.ButtonClickEvent,
        name: 'manage-key',
      },
    });

    const json = rendered(interfaces.get('interface-1'));
    expect(json).toContain('Settings');
    expect(json).toContain('Bitcoin private key');
    expect(json).toContain('cancel-edit-key');
    expect(json).toContain('Validator URL');
    expect(json).not.toContain('Bitcoin Master Key');
    expect(json).not.toContain('"type":"Section"');
    await handleHomeNavigationInput({ id: 'interface-1', context: { screen: 'settings', network: 'mutinynet' }, event: { type: UserInputEventType.ButtonClickEvent, name: 'cancel-edit-key' } });
    const cancelled = rendered(interfaces.get('interface-1'));
    expect(cancelled).toContain('Bitcoin public key');
    expect(cancelled).toContain('Settings');
    expect(cancelled).not.toContain('"name":"privateKey"');
  });

  it('opens endpoint-specific management screens from the overview', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });

    await handleHomeNavigationInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'mutinynet' },
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
      context: { screen: 'home', network: 'mutinynet' },
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
    const { interfaces, state } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });

    await handleHomeNetworkInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'mutinynet' },
      event: {
        type: UserInputEventType.InputChangeEvent,
        name: 'homeNetwork',
        value: 'mainnet',
      },
    });

    expect(state().selectedNetwork).toBe('mainnet');
    expect(rendered(interfaces.get('interface-1'))).toContain('Mainnet');
  });

  it('reverts the Home dropdown when the confirmation is rejected', async () => {
    const { interfaces, state } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' }, false);

    await handleHomeNetworkInput({
      id: 'interface-1',
      context: { screen: 'home', network: 'mutinynet' },
      event: {
        type: UserInputEventType.InputChangeEvent,
        name: 'homeNetwork',
        value: 'mainnet',
      },
    });

    expect(state().selectedNetwork).toBe('mutinynet');
    expect(rendered(interfaces.get('interface-1'))).toContain('Testnet');
  });
});


describe('Native Home and Settings navigation', () => {
  const ethAddress = '0x1234567890123456789012345678901234567890';
  const ethereumRequest = jest.fn();
  beforeEach(() => {
    ethereumRequest.mockReset().mockResolvedValue([ethAddress]);
    (globalThis as any).ethereum = { request: ethereumRequest };
  });
  afterEach(() => { delete (globalThis as any).ethereum; });

  it('opens Settings without waiting on balance endpoints and closes back to balances', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    jest.mocked(getWalletInventory).mockClear();
    await handleHomeNavigationInput({ id: 'settings', context: { network: 'mutinynet' }, event: { type: UserInputEventType.ButtonClickEvent, name: 'home-settings' } });
    const settings = rendered(interfaces.get('settings'));
    expect(settings).toContain('Settings');
    expect(settings).toContain('home-close-settings');
    expect(settings).toContain('edit-endpoint:validator');
    expect(getWalletInventory).not.toHaveBeenCalled();
    expect(ethereumRequest).not.toHaveBeenCalled();
    expect((settings.match(/"type":"Divider"/gu) ?? []).length).toBe(1);
    await handleHomeNavigationInput({ id: 'settings', context: { network: 'mutinynet' }, event: { type: UserInputEventType.ButtonClickEvent, name: 'home-close-settings' } });
    expect(rendered(interfaces.get('settings'))).toContain('Estimated total');
    expect(rendered(interfaces.get('settings'))).not.toContain('home-close-settings');
  });

  it('keeps Settings open when switching networks', async () => {
    const { interfaces, state } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    await handleHomeNetworkInput({ id: 'settings', context: { screen: 'settings', network: 'mutinynet' }, event: { type: UserInputEventType.InputChangeEvent, name: 'homeNetwork', value: 'mainnet' } });
    expect(state().selectedNetwork).toBe('mainnet');
    expect(rendered(interfaces.get('settings'))).toContain('Settings');
    expect(rendered(interfaces.get('settings'))).toContain('https://validator-mutinynet.prod.ducatprotocol.com');
  });

  it.each(['btc', 'unit', 'eth'] as const)('expands %s across the address row and restores all three columns on collapse', async kind => {
    const { request, interfaces, contexts } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    const home = await getHomeState('mutinynet', false);
    await updateHomeInterface('home', 'mutinynet');
    expect(nodes(interfaces.get('home'), 'Copyable')).toEqual([]);
    const event = { type: UserInputEventType.ButtonClickEvent as const, name: `home-toggle-copy-${kind}` };
    await handleHomeNavigationInput({ id: 'home', context: contexts.get('home'), event });
    expect(nodes(interfaces.get('home'), 'Copyable').map(node => node.props.value)).toEqual([{ btc: home.accounts.sats, unit: home.accounts.runes, eth: ethAddress }[kind]]);
    expect(rendered(interfaces.get('home'))).not.toContain(`home-toggle-copy-${kind === 'btc' ? 'unit' : 'btc'}`);
    await handleHomeNavigationInput({ id: 'home', context: contexts.get('home'), event });
    expect(nodes(interfaces.get('home'), 'Copyable')).toEqual([]);
    expect(rendered(interfaces.get('home'))).toContain('home-toggle-copy-btc');
    expect(rendered(interfaces.get('home'))).toContain('home-toggle-copy-unit');
    expect(rendered(interfaces.get('home'))).toContain('home-toggle-copy-eth');
    expect(ethereumRequest.mock.calls.every(([args]) => args.method === 'eth_accounts')).toBe(true);
    expect(request.mock.calls.some(([args]) => args.method === 'snap_dialog')).toBe(false);
  });

  it('uses the existing MetaMask account when Home opens without a connect button or another prompt', async () => {
    const { interfaces, contexts } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    expect(await onHomePage()).toEqual({ id: 'home' });
    expect(rendered(interfaces.get('home'))).toContain('home-toggle-copy-eth');
    expect(rendered(interfaces.get('home'))).toContain('0x1234…7890');
    expect(rendered(interfaces.get('home'))).not.toContain('home-connect-eth');
    expect(ethereumRequest.mock.calls.every(([args]) => args.method === 'eth_accounts')).toBe(true);
    expect(contexts.get('home').screen).toBe('home');
  });

  it('requests missing permission on Home entry and then displays the approved account', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    ethereumRequest.mockResolvedValueOnce([]);
    await onHomePage();
    expect(ethereumRequest.mock.calls.filter(([args]) => args.method === 'eth_requestAccounts')).toHaveLength(1);
    expect(rendered(interfaces.get('home'))).toContain('0x1234…7890');
    expect(rendered(interfaces.get('home'))).not.toContain('home-connect-eth');
  });

  it('keeps Home usable after declining ETH access and never re-prompts during navigation', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    ethereumRequest.mockResolvedValue([]).mockResolvedValueOnce([]).mockRejectedValueOnce({ code: 4001 });
    await onHomePage();
    const json = rendered(interfaces.get('home'));
    expect(json).not.toContain('home-connect-eth');
    expect(json).not.toContain('home-toggle-copy-eth');
    expect(json).toContain('home-toggle-copy-btc');
    expect(json).toContain('home-toggle-copy-unit');
    expect(json).not.toContain('Wallet data unavailable');
    await handleHomeNavigationInput({ id: 'home', context: { screen: 'home', network: 'mutinynet' }, event: { type: UserInputEventType.ButtonClickEvent, name: 'home-settings' } });
    await handleHomeNavigationInput({ id: 'home', context: { screen: 'settings', network: 'mutinynet' }, event: { type: UserInputEventType.ButtonClickEvent, name: 'home-close-settings' } });
    expect(ethereumRequest.mock.calls.filter(([args]) => args.method === 'eth_requestAccounts')).toHaveLength(1);
  });

  it('explains wUNIT availability on Mainnet without claiming a zero balance', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mainnet' });
    jest.mocked(homeEvmBalances).mockResolvedValueOnce({ ethWei: null, wunit: null, usdc: null, wunitConfigured: false });
    await updateHomeInterface('home', 'mainnet');
    const json = rendered(interfaces.get('home'));
    expect(json).toContain('Available on Testnet');
    expect(json).not.toContain('Not configured');
    expect(json).not.toContain('0 wUNIT');
  });

  it('renders all five holdings in order and includes their USD values in the total', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    jest.mocked(homeBitcoinPrice).mockResolvedValueOnce(8_000_000n);
    jest.mocked(homeEthereumPrice).mockResolvedValueOnce(200_000n);
    jest.mocked(getWalletInventory).mockResolvedValueOnce({ balances: {
      btcSats: '1000000', unitActive: '1927', unitReserved: '0', unitMixedActive: '0', unitMixedReserved: '0',
    } } as any);
    jest.mocked(homeEvmBalances).mockResolvedValueOnce({ ethWei: '200000000000000000', wunit: '5050000', usdc: '3154583', wunitConfigured: true });
    await updateHomeInterface('home', 'mutinynet');
    const ui = interfaces.get('home');
    expect(nodes(ui, 'Image').map(node => node.props.alt).filter(Boolean)).toEqual(['Bitcoin', 'UNIT', 'ETH', 'wUNIT', 'USDC']);
    expect(nodes(ui, 'Heading').map(node => node.props.children)).toContain('$1,227.47');
    const json = rendered(ui);
    for (const value of ['0.2 ETH', '5.05 wUNIT', '3.154583 USDC']) expect(json).toContain(value);
  });

  it.each(['key', 'validator', 'esplora'] as const)('expands and collapses %s in Settings without a dialog or balance reads', async kind => {
    const { request, interfaces, contexts } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    const home = await getHomeState('mutinynet', false);
    jest.mocked(getWalletInventory).mockClear();
    await updateHomeInterface('settings', 'mutinynet', {}, 'settings');
    expect(nodes(interfaces.get('settings'), 'Copyable')).toEqual([]);
    const event = { type: UserInputEventType.ButtonClickEvent as const, name: `home-toggle-copy-${kind}` };
    await handleHomeNavigationInput({ id: 'settings', context: contexts.get('settings'), event });
    const expected = { key: home.publicKeys.sats.pubkey, validator: 'https://validator-mutinynet.prod.ducatprotocol.com', esplora: 'https://mutinynet.com/api' };
    expect(nodes(interfaces.get('settings'), 'Copyable').map(node => node.props.value)).toEqual([expected[kind]]);
    expect(nodes(interfaces.get('settings'), 'Text').some(node => node.props.children === expected[kind])).toBe(false);
    expect(contexts.get('settings').screen).toBe('settings');
    await handleHomeNavigationInput({ id: 'settings', context: contexts.get('settings'), event });
    expect(nodes(interfaces.get('settings'), 'Copyable')).toEqual([]);
    expect(getWalletInventory).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([args]) => args.method === 'snap_dialog')).toBe(false);
  });

  it('keeps the endpoint editor and lets MetaMask retain its draft while expanding another value', async () => {
    const { interfaces, contexts } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    await updateHomeInterface('settings', 'mutinynet', { editingEndpoint: 'validator' }, 'settings');
    await handleHomeNavigationInput({ id: 'settings', context: contexts.get('settings'), event: { type: UserInputEventType.ButtonClickEvent, name: 'home-toggle-copy-key' } });
    expect(contexts.get('settings').editingEndpoint).toBe('validator');
    const input = nodes(interfaces.get('settings'), 'Input').find(node => node.props.name === 'endpointUrl');
    expect(input).toBeDefined();
    expect(input.props.value).toBeUndefined();
    expect(rendered(interfaces.get('settings'))).toContain('save-endpoint:validator');
  });

  it('refreshes a stale disclosure without expanding a value from another network', async () => {
    const { interfaces, contexts } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mainnet' });
    await handleHomeNavigationInput({ id: 'home', context: { screen: 'home', network: 'mutinynet' }, event: { type: UserInputEventType.ButtonClickEvent, name: 'home-toggle-copy-btc' } });
    expect(contexts.get('home').network).toBe('mainnet');
    expect(nodes(interfaces.get('home'), 'Copyable')).toEqual([]);
  });

  it('converts base units exactly, including values beyond Number precision', () => {
    expect(homeAmount('1065757', 8, 'BTC')).toBe('0.01065757 BTC');
    expect(homeAmount('1927', 2, 'UNIT')).toBe('19.27 UNIT');
    expect(homeAmount('900719925474099312345', 2, 'UNIT')).toBe('9,007,199,254,740,993,123.45 UNIT');
    expect(homeAmount('0', 2, 'UNIT')).toBe('0 UNIT');
    expect(homeAmount(null, 8, 'BTC')).toBe('Unavailable');
    expect(homeAmount('184323987654321000', 18, 'ETH', 6)).toBe('0.184323 ETH');
    expect(homeAmount('1', 18, 'ETH', 6)).toBe('<0.000001 ETH');
  });
});


describe('Compact network and copy controls', () => {
  it('opens and closes the selector from its arrow', async () => {
    const { interfaces } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    await handleHomeNetworkInput({ id:'home', context:{network:'mutinynet',networkMenu:false}, event:{type:UserInputEventType.ButtonClickEvent,name:'home-network-toggle'} });
    expect(rendered(interfaces.get('home'))).toContain('"name":"home-network-mainnet"');
    await handleHomeNetworkInput({ id:'home', context:{network:'mutinynet',networkMenu:true}, event:{type:UserInputEventType.ButtonClickEvent,name:'home-network-toggle'} });
    expect(rendered(interfaces.get('home'))).not.toContain('"name":"home-network-mainnet"');
  });
  it('ignores retired copy button events without opening a dialog', async () => {
    const { request } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mainnet' });
    await handleHomeNavigationInput({ id:'home', context:{network:'mutinynet'}, event:{type:UserInputEventType.ButtonClickEvent,name:'home-copy-btc'} });
    expect(request).not.toHaveBeenCalled();
  });
});


test('choosing a compact menu item preserves Settings and its selected network', async () => {
  const { state, interfaces } = setSnapStateMock({recentActions:[],selectedNetwork:'mutinynet'});
  await handleHomeNetworkInput({id:'settings',context:{screen:'settings',network:'mutinynet',networkMenu:true},event:{type:UserInputEventType.ButtonClickEvent,name:'home-network-mainnet'}});
  expect(state().selectedNetwork).toBe('mainnet');
  expect(rendered(interfaces.get('settings'))).toContain('home-close-settings');
  expect(rendered(interfaces.get('settings'))).not.toContain('"type":"Dropdown"');
});
