import { UserInputEventType } from '@metamask/snaps-sdk';

import { handleEndpointOverrideInput, renderNetworkEndpointContent } from '../home-network-endpoints';
import type { DucatSnapState } from '../types';

type SnapRequestArgs = {
  method: string;
  params?: {
    id?: unknown;
    key?: keyof DucatSnapState;
    operation?: string;
    ui?: unknown;
    value?: unknown;
  };
};

function rendered(value: unknown): string {
  return JSON.stringify(value);
}

function setSnapStateMock(initialState: DucatSnapState) {
  let managedState: DucatSnapState = initialState;
  const interfaces = new Map<string, unknown>();
  const request = jest.fn(async ({ method, params }: SnapRequestArgs) => {
    if (method === 'snap_manageState') {
      if (params?.operation === 'get') return managedState;
    }
    if (method === 'snap_setState' && params?.key) {
      managedState = { ...managedState, [params.key]: params.value };
      return null;
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

describe('Snap Home network endpoint override UI', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/proto/latest')) {
        return Response.json({ chain_network: 'mutiny' });
      }
      if (url.endsWith('/block-height/0')) {
        return new Response('00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6');
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders current effective endpoints with edit and clear controls instead of separate override fields', () => {
    const content = renderNetworkEndpointContent({
      network: 'mutinynet',
      status: null,
      profile: {
        id: 'mutinynet',
        label: 'Signet',
        bitcoin_network: 'signet',
        expected_validator_chain_network: 'mutiny',
        validator_base_url: 'https://validator-testnet4.dev.ducatprotocol.com',
        esplora_base_url: 'https://mempool.space/signet/api',
      },
      defaultProfile: {
        id: 'mutinynet',
        label: 'Signet',
        bitcoin_network: 'signet',
        expected_validator_chain_network: 'mutiny',
        validator_base_url: 'https://validator-testnet4.dev.ducatprotocol.com',
        esplora_base_url: 'https://mempool.space/signet/api',
      },
      editingEndpoint: null,
    });

    const json = rendered(content);
    expect(json).toContain('Network endpoints');
    expect(json).toContain('https://validator-testnet4.dev.ducatprotocol.com');
    expect(json).toContain('https://mempool.space/signet/api');
    expect(json).toContain('edit-endpoint:validator');
    expect(json).toContain('edit-endpoint:esplora');
    expect(json).toContain('clear-endpoint:validator');
    expect(json).toContain('clear-endpoint:esplora');
    expect(json).not.toContain('Validator URL override');
    expect(json).not.toContain('Esplora URL override');
    expect(json).not.toContain('Save endpoint overrides');
  });

  it('renders one endpoint as an editable URL field', () => {
    const content = renderNetworkEndpointContent({
      network: 'mutinynet',
      status: null,
      profile: {
        id: 'mutinynet',
        label: 'Signet',
        bitcoin_network: 'signet',
        expected_validator_chain_network: 'mutiny',
        validator_base_url: 'https://validator-override.example',
        esplora_base_url: 'https://mempool.space/signet/api',
      },
      defaultProfile: {
        id: 'mutinynet',
        label: 'Signet',
        bitcoin_network: 'signet',
        expected_validator_chain_network: 'mutiny',
        validator_base_url: 'https://validator-testnet4.dev.ducatprotocol.com',
        esplora_base_url: 'https://mempool.space/signet/api',
      },
      editingEndpoint: 'validator',
    });

    const json = rendered(content);
    expect(json).toContain('save-endpoint:validator');
    expect(json).toContain('"name":"endpointUrl"');
    expect(json).toContain('https://validator-override.example');
    expect(json).toContain('cancel-edit-endpoint:validator');
  });

  it('saves one endpoint override from Snap Home without replacing the other endpoint override', async () => {
    const { state } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });

    await handleEndpointOverrideInput({
      id: 'interface-1',
      context: { screen: 'network-endpoints', network: 'mutinynet' },
      event: {
        type: UserInputEventType.FormSubmitEvent,
        name: 'save-endpoint:validator',
        value: {
          endpointUrl: 'https://validator-override.example',
        },
      },
    });

    await handleEndpointOverrideInput({
      id: 'interface-1',
      context: { screen: 'network-endpoints', network: 'mutinynet' },
      event: {
        type: UserInputEventType.FormSubmitEvent,
        name: 'save-endpoint:esplora',
        value: {
          endpointUrl: 'https://esplora-override.example/api',
        },
      },
    });

    expect(state().networkEndpointOverrides?.mutinynet).toEqual({
      validator_base_url: 'https://validator-override.example',
      esplora_base_url: 'https://esplora-override.example/api',
      network_identity_verified: true,
    });
  });

  it('clears one endpoint override from Snap Home without clearing the other endpoint override', async () => {
    const { state } = setSnapStateMock({
      recentActions: [],
      selectedNetwork: 'mutinynet',
      networkEndpointOverrides: {
        mutinynet: {
          validator_base_url: 'https://validator-override.example',
          esplora_base_url: 'https://esplora-override.example/api',
          network_identity_verified: true,
        },
      },
    });

    await handleEndpointOverrideInput({
      id: 'interface-1',
      context: { screen: 'network-endpoints', network: 'mutinynet' },
      event: {
        type: UserInputEventType.ButtonClickEvent,
        name: 'clear-endpoint:validator',
      },
    });

    expect(state().networkEndpointOverrides?.mutinynet).toEqual({
      esplora_base_url: 'https://esplora-override.example/api',
      network_identity_verified: true,
    });
  });

  it('does not persist an endpoint that reports another network', async () => {
    const { state } = setSnapStateMock({ recentActions: [], selectedNetwork: 'mutinynet' });
    globalThis.fetch = jest.fn(async () => Response.json({ chain_network: 'testnet4' })) as typeof fetch;

    await expect(handleEndpointOverrideInput({
      id: 'interface-1',
      context: { screen: 'network-endpoints', network: 'mutinynet' },
      event: {
        type: UserInputEventType.FormSubmitEvent,
        name: 'save-endpoint:validator',
        value: { endpointUrl: 'https://validator-wrong-network.example' },
      },
    })).rejects.toThrow('validator endpoint did not report mutiny');

    expect(state().networkEndpointOverrides).toBeUndefined();
  });
});
