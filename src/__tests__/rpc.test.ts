import { opcodes, Psbt, script as btcScript } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { ComponentOrElementStruct } from '@metamask/snaps-sdk';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';
import { getJsonSizeUnsafe, validateJsxElements } from '@metamask/snaps-utils';

import { deriveAccountSetFromBaseNodes, p2trAccount, p2wpkhAccount, toXOnly } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { confirmBatch, confirmPsbt } from '../confirmations';
import { renderHomePage } from '../home';
import { truncateMiddle } from '../display';
import { networkProfile } from '../network-profiles';
import { bitcoinNetwork } from '../networks';
import { ALLOWED_ORIGINS, handleRpcRequest } from '../rpc';
import { getWalletInventory, invalidateWalletInventory } from '../wallet-inventory';
import { uiBox, uiCopyable } from '../ui';
import type { PrivateKeyOverrideRecord, PsbtOutputSummary, PsbtSummary } from '../types';
import packageJson from '../../package.json';
import manifest from '../../snap.manifest.json';

jest.mock('../psbt-verification', () => ({
  createPsbtVerificationContext: jest.fn(async () => ({ verify: jest.fn(async () => undefined) })),
}));
jest.mock('../wallet-inventory', () => ({
  getWalletInventory: jest.fn(async () => ({
    balances: {
      btcSats: '12345', btcUtxos: 1, unitActive: '10000', unitReserved: '0',
      unitMixedActive: '0', unitMixedReserved: '0',
    },
  })),
  invalidateWalletInventory: jest.fn(),
}));

const ORIGIN = 'https://app.ducatprotocol.com';
const DEV_ORIGIN = 'http://localhost:3000';
const ALPHA_ORIGIN = 'http://localhost:8075';

const REGISTERED_NETWORK_METHODS = [
  'ducat_getAccounts',
  'ducat_getWalletInventory',
  'ducat_switchNetwork',
  'ducat_signMessage',
  'ducat_signPsbt',
  'ducat_signBatch',
] as const;

type SnapRequestArgs = {
  method: string;
  params?: {
    context?: unknown;
    id?: unknown;
    key?: string;
    message?: string;
    operation?: string;
    path?: string[];
    type?: string;
    ui?: unknown;
    value?: unknown;
  };
};

type SnapRequestMock = jest.Mock & {
  interfaces: Map<string, unknown>;
};

function testNode(byte: number) {
  return DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
}

function testKeySet() {
  return deriveAccountSetFromBaseNodes('signet', testNode(1), testNode(2));
}

function keyOverride(byte = 9): PrivateKeyOverrideRecord {
  const node = DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32));
  const publicKey = Buffer.from(node.publicKey);
  const sats = p2wpkhAccount('signet', publicKey);
  const runes = p2trAccount('signet', toXOnly(publicKey));

  return {
    id: 'imported-signet-1',
    source: 'imported',
    network: 'signet',
    created_at: 1_700_000_000,
    fingerprint: `signet:${runes.address}`,
    private_key: Buffer.alloc(32, byte).toString('hex'),
    sats: { address: sats.address, pubkey: sats.pubkey },
    runes: { address: runes.address, pubkey: runes.pubkey },
  };
}

function setSnapMock(dialogResult = true, initialState: unknown = null): SnapRequestMock {
  let managedState: unknown = initialState && typeof initialState === 'object' && !Array.isArray(initialState)
    ? ('selectedNetwork' in initialState
      ? initialState
      : { ...initialState, selectedNetwork: 'signet' })
    : { recentActions: [], selectedNetwork: 'signet' };
  let interfaceCount = 0;
  const interfaces = new Map<string, unknown>();
  const request = jest.fn(async ({ method, params }: SnapRequestArgs) => {
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

    if (method === 'snap_manageState') {
      if (params?.operation === 'get') {
        return managedState;
      }
    }

    if (method === 'snap_setState' && params?.key) {
      const current = managedState && typeof managedState === 'object' && !Array.isArray(managedState)
        ? managedState
        : {};
      managedState = { ...current, [params.key]: params.value };
      return null;
    }

    if (method === 'snap_notify') {
      return undefined;
    }

    if (method === 'snap_createInterface') {
      interfaceCount += 1;
      const id = `interface-${interfaceCount}`;
      interfaces.set(id, params?.ui);
      return id;
    }

    if (method === 'snap_updateInterface') {
      interfaces.set(String(params?.id), params?.ui);
      return undefined;
    }

    throw new Error(`Unexpected Snap method ${method}`);
  }) as SnapRequestMock;

  request.interfaces = interfaces;

  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };

  return request;
}

function loadDevelopmentRpc(): typeof import('../rpc') {
  const previous = {
    policy: process.env.DUCAT_SNAP_ARTIFACT_POLICY,
    origins: process.env.DUCAT_SNAP_DEV_ORIGINS,
    unprompted: process.env.DUCAT_SNAP_DEV_UNPROMPTED,
    debug: process.env.DUCAT_SNAP_DEBUG,
  };
  process.env.DUCAT_SNAP_ARTIFACT_POLICY = 'development';
  process.env.DUCAT_SNAP_DEV_ORIGINS = DEV_ORIGIN;
  process.env.DUCAT_SNAP_DEV_UNPROMPTED = 'true';
  process.env.DUCAT_SNAP_DEBUG = 'false';

  jest.resetModules();
  const module = require('../rpc') as typeof import('../rpc');

  for (const [name, value] of [
    ['DUCAT_SNAP_ARTIFACT_POLICY', previous.policy],
    ['DUCAT_SNAP_DEV_ORIGINS', previous.origins],
    ['DUCAT_SNAP_DEV_UNPROMPTED', previous.unprompted],
    ['DUCAT_SNAP_DEBUG', previous.debug],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  jest.resetModules();
  return module;
}

function makePsbt(value: number, seed: number) {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: {
      script: keySet.satsOutputScript,
      value,
    },
  });
  psbt.addOutput({
    address: keySet.record.sats.address,
    value: value - 1_000,
  });

  return { keySet, psbt: psbt.toBase64() };
}

function makeImportedPsbt(value: number, seed: number, account: PrivateKeyOverrideRecord) {
  const imported = p2wpkhAccount('signet', Buffer.from(account.sats.pubkey, 'hex'));
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: {
      script: imported.output,
      value,
    },
  });
  psbt.addOutput({
    address: imported.address,
    value: value - 1_000,
  });

  return { psbt: psbt.toBase64(), address: imported.address };
}

function makeExternalPsbt(value: number, seed: number) {
  const keySet = testKeySet();
  const external = deriveAccountSetFromBaseNodes('signet', testNode(7), testNode(8));
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: {
      script: keySet.satsOutputScript,
      value,
    },
  });
  psbt.addOutput({
    address: external.record.sats.address,
    value: value - 2_000,
  });
  psbt.addOutput({
    address: keySet.record.sats.address,
    value: 1_000,
  });

  return { keySet, psbt: psbt.toBase64() };
}

function makeOutputBoundPsbt(outputCount: number, seed: number, recipient: string) {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: { script: keySet.satsOutputScript, value: outputCount * 1_000 + 1_000 },
  });
  for (let index = 0; index < outputCount; index++) {
    psbt.addOutput({ address: recipient, value: 1_000 });
  }

  return { keySet, psbt: psbt.toBase64() };
}

function makeNearMaximumPayloadPsbt(seed: number) {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });
  const scripts: string[] = [];

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: { script: keySet.satsOutputScript, value: 100_000 },
  });
  for (let index = 0; index < 120; index++) {
    const script = Buffer.alloc(2_140, (seed + index) % 256);
    script.writeUInt16BE(index, 0);
    script.writeUInt8(seed, 2);
    scripts.push(script.toString('hex'));
    psbt.addOutput({ script, value: 0 });
  }

  const encoded = psbt.toBase64();

  if (encoded.length <= 340_000 || encoded.length > 350_000) {
    throw new Error(`Near-maximum PSBT fixture has unexpected base64 length ${encoded.length}.`);
  }

  return { keySet, psbt: encoded, scripts };
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);

  return buffer;
}

function occurrenceCount(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

function vaultReturnPayload(flag: string, unitBalanceCents: number, unitPrice: number, unitTimestamp: number, tholdPrice?: number): Buffer {
  return Buffer.concat([
    Buffer.from([1, flag.charCodeAt(0)]),
    uint32(unitBalanceCents),
    uint32(unitPrice),
    uint32(unitTimestamp),
    ...(unitBalanceCents > 0 ? [uint32(tholdPrice ?? 45_000), Buffer.alloc(20, 12)] : []),
  ]);
}

function makeVaultReturnPsbt(value: number, seed: number) {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: {
      script: keySet.satsOutputScript,
      value,
    },
  });
  psbt.addOutput({
    address: keySet.record.vault.address,
    value: 1_100_000,
  });
  psbt.addOutput({
    script: btcScript.compile([opcodes.OP_RETURN, opcodes.OP_8, vaultReturnPayload('d', 50_000, 60_000, 123_456, 45_000)]),
    value: 0,
  });
  psbt.addOutput({
    address: keySet.record.sats.address,
    value: value - 1_101_000,
  });

  return { keySet, psbt: psbt.toBase64() };
}

function makeVaultInputPsbt(value: number, seed: number) {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: {
      script: keySet.vaultOutputScript,
      value,
    },
  });
  psbt.addOutput({
    address: keySet.record.sats.address,
    value: value - 1_000,
  });

  return { keySet, psbt: psbt.toBase64() };
}

function dialogValues(request: jest.Mock): string[] {
  const dialogCall = request.mock.calls.find(([arg]) => arg.method === 'snap_dialog');

  return collectDialogText(dialogCall?.[0].params?.content);
}

function dialogContent(request: jest.Mock): JSXElement {
  const dialogCall = request.mock.calls.find(([arg]) => arg.method === 'snap_dialog');

  if (!dialogCall) {
    throw new Error('Expected a snap_dialog call.');
  }

  return dialogCall[0].params.content as JSXElement;
}

function jsxNodes(value: unknown, type: string): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => jsxNodes(item, type));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as { type?: unknown; props?: Record<string, unknown> };
  const own = record.type === type ? [record as Record<string, unknown>] : [];

  return [...own, ...jsxNodes(record.props?.children, type)];
}

function collapsibleSection(content: JSXElement, label: string): Record<string, unknown> {
  const section = jsxNodes(content, 'CollapsibleSection').find((node) => {
    const props = node.props as Record<string, unknown> | undefined;

    return props?.label === label;
  });

  if (!section) {
    throw new Error(`Missing collapsible section: ${label}`);
  }

  return section;
}

function copyableValues(value: unknown): string[] {
  return jsxNodes(value, 'Copyable')
    .map((node) => (node.props as Record<string, unknown> | undefined)?.value)
    .filter((item): item is string => typeof item === 'string');
}

function validateCapturedTree(tree: JSXElement, label: string): number {
  ComponentOrElementStruct.assert(tree);
  validateJsxElements(tree, {
    isOnPhishingList: () => false,
    getSnap: () => null,
    getAccountByAddress: () => undefined,
    hasPermission: () => true,
  });
  const jsonLength = getJsonSizeUnsafe(tree);

  expect(jsonLength).toBe(JSON.stringify(tree).length);
  if (jsonLength > 10_000_000) {
    throw new Error(`${label} JSON length ${jsonLength} exceeds the 10,000,000-character controller limit.`);
  }

  return jsonLength;
}

function summaryWithOutputs(outputs: PsbtOutputSummary[]): PsbtSummary {
  const externalOutputSats = outputs.filter((output) => !output.isMine).reduce((total, output) => total + output.valueSats, 0);
  const selfOutputSats = outputs.filter((output) => output.isMine).reduce((total, output) => total + output.valueSats, 0);

  return {
    network: 'signet',
    inputCount: 1,
    signedInputIndexes: [0],
    signedInputs: [],
    outputCount: outputs.length,
    outputs,
    feeSats: 1_000,
    inputValueSats: externalOutputSats + selfOutputSats + 1_000,
    signedInputValueSats: externalOutputSats + selfOutputSats + 1_000,
    unitInputs: [],
    outputValueSats: externalOutputSats + selfOutputSats,
    externalOutputSats,
    selfOutputSats,
    vaultUpdates: [],
    warnings: [],
  };
}

function notificationMessages(request: jest.Mock): string[] {
  return request.mock.calls
    .filter(([arg]) => arg.method === 'snap_notify')
    .map(([arg]) => arg.params?.message)
    .filter((message): message is string => typeof message === 'string');
}

function collectDialogText(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectDialogText);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as {
    children?: unknown;
    label?: unknown;
    props?: Record<string, unknown>;
    title?: unknown;
    value?: unknown;
  };
  const props = record.props ?? {};

  return [
    typeof record.value === 'string' ? record.value : null,
    typeof record.label === 'string' ? record.label : null,
    typeof record.title === 'string' ? record.title : null,
    typeof props.value === 'string' ? props.value : null,
    typeof props.extra === 'string' ? props.extra : null,
    typeof props.description === 'string' ? props.description : null,
    typeof props.label === 'string' ? props.label : null,
    typeof props.title === 'string' ? props.title : null,
    typeof props.tooltip === 'string' ? props.tooltip : null,
    ...collectDialogText(record.children),
    ...collectDialogText(props.children),
  ].filter((item): item is string => typeof item === 'string');
}

describe('RPC router', () => {
  it('uses bundled network profiles for Snap network data', () => {
    expect(networkProfile('mainnet').validator_base_url).toBe('https://validator-mainnet.prod.ducatprotocol.com');
    expect(networkProfile('signet').validator_base_url).toBe('https://validator-testnet4.dev.ducatprotocol.com');
    expect(networkProfile('mutinynet').validator_base_url).toBe('https://validator-mutinynet.dev.ducatprotocol.com');
  });

  it('rejects unknown RPC methods', async () => {
    await expect(handleRpcRequest(ORIGIN, { method: 'ducat_unknown' })).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('keeps RPC origin authorization in sync with the manifest', () => {
    const manifestOrigins = manifest.initialPermissions['endowment:rpc'].allowedOrigins;

    expect([...ALLOWED_ORIGINS].sort()).toEqual([...manifestOrigins].sort());
  });

  // Dev builds patch only the generated `.snap/dev` manifest. This remains a
  // defense-in-depth check that a development origin never enters the tracked
  // production manifest.
  it('committed manifest authorizes only HTTPS Ducat origins (no dev origins leak)', () => {
    const manifestOrigins: string[] = manifest.initialPermissions['endowment:rpc'].allowedOrigins;

    for (const origin of manifestOrigins) {
      expect(origin.startsWith('https://')).toBe(true);
      expect(new URL(origin).hostname.endsWith('.ducatprotocol.com')).toBe(true);
    }
  });

  it('authorizes no dev origins in the default (published) build', () => {
    jest.isolateModules(() => {
      delete process.env.DUCAT_SNAP_DEV_ORIGINS;
      const { ALLOWED_ORIGINS: published } = require('../rpc');
      expect([...published].every((origin: string) => origin.startsWith('https://'))).toBe(true);
      expect(published.has('http://localhost:3000')).toBe(false);
    });
  });

  it('derives exact origins, profiles, and capabilities for a dev build', async () => {
    let developmentRpc!: typeof import('../rpc');
    try {
      jest.isolateModules(() => {
        process.env.DUCAT_SNAP_ARTIFACT_POLICY = 'development';
        process.env.DUCAT_SNAP_DEV_ORIGINS = 'http://localhost:3000, http://localhost:8075, http://frontend:3000, http://ducat-admin:8075';
        developmentRpc = require('../rpc') as typeof import('../rpc');
        const { ALLOWED_ORIGINS: dev } = developmentRpc;
        const { networkProfiles: developmentProfiles } = require('../network-profiles') as typeof import('../network-profiles');
        expect(dev.has('http://localhost:3000')).toBe(true);
        expect(dev.has('http://localhost:8075')).toBe(true);
        expect(dev.has('http://frontend:3000')).toBe(true);
        expect(dev.has('http://ducat-admin:8075')).toBe(true);
        expect(dev.has('https://app.ducatprotocol.com')).toBe(false);
        expect(dev.has('https://evil.example')).toBe(false);
        expect(developmentProfiles().map((profile) => profile.id)).toEqual(['signet', 'mutinynet', 'testnet4', 'regtest']);
      });
    } finally {
      process.env.DUCAT_SNAP_ARTIFACT_POLICY = 'production';
      delete process.env.DUCAT_SNAP_DEV_ORIGINS;
    }

    await expect(developmentRpc.handleRpcRequest('http://localhost:3000', {
      method: 'ducat_getCapabilities',
    })).resolves.toEqual(expect.objectContaining({
      networks: ['regtest', 'signet', 'mutinynet', 'testnet4'],
      features: expect.objectContaining({ mainnet: false }),
    }));
  });

  it('derives exact origin, profile, and prompted capabilities for an alpha build', async () => {
    let alphaRpc!: typeof import('../rpc');
    const previous = {
      policy: process.env.DUCAT_SNAP_ARTIFACT_POLICY,
      validator: process.env.ALPHA_MAINNET_VALIDATOR_BASE_URL,
      esplora: process.env.ALPHA_MAINNET_ESPLORA_BASE_URL,
      origin: process.env.DUCAT_SNAP_ALPHA_ORIGIN,
    };
    try {
      jest.isolateModules(() => {
        process.env.DUCAT_SNAP_ARTIFACT_POLICY = 'alpha-mainnet';
        process.env.ALPHA_MAINNET_VALIDATOR_BASE_URL = 'https://validator.invalid';
        process.env.ALPHA_MAINNET_ESPLORA_BASE_URL = 'https://esplora.invalid';
        process.env.DUCAT_SNAP_ALPHA_ORIGIN = ALPHA_ORIGIN;
        jest.doMock('../artifact-policy', () => require('../artifact-policy.alpha'));
        jest.doMock('../network-profiles', () => require('../network-profiles.alpha'));
        alphaRpc = require('../rpc') as typeof import('../rpc');
        const { networkProfiles: alphaProfiles } = require('../network-profiles.alpha') as typeof import('../network-profiles');
        expect([...alphaRpc.ALLOWED_ORIGINS]).toEqual([ALPHA_ORIGIN]);
        expect(alphaProfiles().map((profile) => profile.id)).toEqual(['alpha-mainnet']);
      });
    } finally {
      jest.dontMock('../artifact-policy');
      jest.dontMock('../network-profiles');
      for (const [name, value] of [
        ['DUCAT_SNAP_ARTIFACT_POLICY', previous.policy],
        ['ALPHA_MAINNET_VALIDATOR_BASE_URL', previous.validator],
        ['ALPHA_MAINNET_ESPLORA_BASE_URL', previous.esplora],
        ['DUCAT_SNAP_ALPHA_ORIGIN', previous.origin],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    await expect(alphaRpc.handleRpcRequest(ALPHA_ORIGIN, {
      method: 'ducat_getCapabilities',
    })).resolves.toEqual(expect.objectContaining({
      networks: ['alpha-mainnet'],
      methods: expect.arrayContaining(['ducat_getAccounts', 'ducat_getWalletInventory', 'ducat_signPsbt']),
      features: expect.objectContaining({ mainnet: false }),
    }));
    await expect(alphaRpc.handleRpcRequest(ALPHA_ORIGIN, {
      method: 'ducat_signPsbtUnprompted',
      params: { network: 'alpha-mainnet' },
    })).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('returns Snap capabilities', async () => {
    const result = await handleRpcRequest(ORIGIN, { method: 'ducat_getCapabilities' });

    expect(result).toEqual({
      snap: '@ducat-unit/wallet-snap',
      version: packageJson.version,
      networks: ['mainnet', 'signet', 'mutinynet', 'testnet4'],
      methods: [
        'ducat_getCapabilities',
        'ducat_getNetwork',
        'ducat_switchNetwork',
        'ducat_getAccounts',
        'ducat_getWalletInventory',
        'ducat_signMessage',
        'ducat_signPsbt',
        'ducat_signBatch',
      ],
      features: {
        batchSigning: true,
        bip322MessageSigning: true,
        completeExternalRecipientVisibility: true,
        explicitNetworkSelection: true,
        mainnet: true,
        psbtSigning: true,
        snapHome: true,
        walletInventory: true,
      },
    });
    expect((result as { methods: string[] }).methods).not.toContain('ducat_signReserveIssue');
    expect((result as { features: Record<string, unknown> }).features).not.toHaveProperty('reserveIssueSigning');
  });

  it('rejects unauthorized origins before requesting entropy', async () => {
    const request = setSnapMock();

    await expect(handleRpcRequest('https://evil.example', { method: 'ducat_getAccounts', params: { network: 'signet' } })).rejects.toMatchObject({
      code: 'ORIGIN_NOT_AUTHORIZED',
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_getBip32Entropy' }));
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it.each(['regtest', 'alpha-mainnet'] as const)(
    'production rejects every registered wallet method on unavailable deployment %s before side effects',
    async (deployment) => {
      const originalFetch = globalThis.fetch;
      const fetchMock = jest.fn();
      globalThis.fetch = fetchMock as typeof fetch;
      try {
        for (const method of REGISTERED_NETWORK_METHODS) {
          const request = setSnapMock();
          await expect(handleRpcRequest(ORIGIN, {
            method,
            params: { network: deployment },
          })).rejects.toMatchObject({
            code: 'DEPLOYMENT_NOT_AVAILABLE',
            details: { artifactPolicy: 'production', deploymentId: deployment },
          });
          expect(request).not.toHaveBeenCalled();
          expect(fetchMock).not.toHaveBeenCalled();
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  it('production keeps the unprompted method absent before deployment parsing or side effects', async () => {
    const request = setSnapMock();

    await expect(handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbtUnprompted',
      params: { network: 'alpha-mainnet' },
    })).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
    expect(request).not.toHaveBeenCalled();
  });

  it('development rejects all mainnet-backed wallet methods before side effects', async () => {
    const development = loadDevelopmentRpc();
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      for (const deployment of ['mainnet', 'alpha-mainnet'] as const) {
        for (const method of [...REGISTERED_NETWORK_METHODS, 'ducat_signPsbtUnprompted']) {
          const request = setSnapMock(true, { recentActions: [], selectedNetwork: deployment });
          await expect(development.handleRpcRequest(DEV_ORIGIN, {
            method,
            params: { network: deployment },
          })).rejects.toMatchObject({
            code: 'DEPLOYMENT_NOT_AVAILABLE',
            details: { artifactPolicy: 'development', deploymentId: deployment },
          });
          expect(request).not.toHaveBeenCalled();
          expect(fetchMock).not.toHaveBeenCalled();
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('development repairs stale mainnet state and cannot switch back', async () => {
    const development = loadDevelopmentRpc();
    const request = setSnapMock(true, { recentActions: [], selectedNetwork: 'mainnet' });

    await expect(development.handleRpcRequest(DEV_ORIGIN, {
      method: 'ducat_getNetwork',
    })).resolves.toEqual({ network: 'regtest', label: 'regtest' });
    await expect(development.handleRpcRequest(DEV_ORIGIN, {
      method: 'ducat_switchNetwork',
      params: { network: 'signet' },
    })).resolves.toEqual({ network: 'signet', changed: true });

    const callCount = request.mock.calls.length;
    await expect(development.handleRpcRequest(DEV_ORIGIN, {
      method: 'ducat_switchNetwork',
      params: { network: 'mainnet' },
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_NOT_AVAILABLE' });
    expect(request).toHaveBeenCalledTimes(callCount);
  });

  it('returns derived Ducat account records', async () => {
    setSnapMock();

    const accounts = await handleRpcRequest(ORIGIN, {
      method: 'ducat_getAccounts',
      params: { network: 'signet' },
    });

    expect(accounts).toEqual(
      expect.objectContaining({
        sats: expect.objectContaining({ address: expect.stringMatching(/^tb1q/), pubkey: expect.stringMatching(/^[0-9a-f]{66}$/) }),
        runes: expect.objectContaining({ address: expect.stringMatching(/^tb1p/), pubkey: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        vault: expect.objectContaining({ address: expect.stringMatching(/^tb1p/), pubkey: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        authCandidates: expect.any(Array),
      }),
    );
    expect((accounts as ReturnType<typeof testKeySet>['record']).runes.address).not.toBe((accounts as ReturnType<typeof testKeySet>['record']).vault.address);
    expect((accounts as ReturnType<typeof testKeySet>['record']).runes.pubkey).not.toBe((accounts as ReturnType<typeof testKeySet>['record']).vault.pubkey);
  });

  it('returns the active imported account without IDs, source labels, or entropy fallback', async () => {
    const override = keyOverride(6);
    const request = setSnapMock(true, {
      recentActions: [],
      keyOverrides: [override],
    });

    const active = await handleRpcRequest(ORIGIN, {
      method: 'ducat_getAccounts',
      params: { network: 'signet' },
    }) as Record<string, unknown>;

    expect(active).toEqual(expect.objectContaining({ sats: override.sats, runes: override.runes }));
    expect(active).not.toHaveProperty('id');
    expect(active).not.toHaveProperty('source');
    expect(active).not.toHaveProperty('private_key');
    expect(request.mock.calls.some(([arg]) => arg.method === 'snap_getBip32Entropy')).toBe(false);
  });

  it.each([
    'ducat_clearRecentActions', 'ducat_getHomeState', 'ducat_getUnitInventory', 'ducat_importPrivateKey',
    'ducat_listAccounts', 'ducat_removeKeyOverride', 'ducat_sendTransfer', 'ducat_sendUnitTransfer',
  ])('rejects removed public method %s', async (method) => {
    setSnapMock();
    await expect(handleRpcRequest(ORIGIN, { method, params: { network: 'signet' } })).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('returns mainnet account records from mainnet entropy paths', async () => {
    const request = setSnapMock(true, { recentActions: [], selectedNetwork: 'mainnet' });

    const accounts = await handleRpcRequest(ORIGIN, {
      method: 'ducat_getAccounts',
      params: { network: 'mainnet' },
    });
    const entropyPaths = request.mock.calls.filter(([arg]) => arg.method === 'snap_getBip32Entropy').map(([arg]) => arg.params?.path);

    expect(accounts).toEqual(
      expect.objectContaining({
        sats: expect.objectContaining({ address: expect.stringMatching(/^bc1q/) }),
        runes: expect.objectContaining({ address: expect.stringMatching(/^bc1p/) }),
        vault: expect.objectContaining({ address: expect.stringMatching(/^bc1p/) }),
      }),
    );
    expect(entropyPaths).toEqual([
      ['m', "84'", "0'"],
      ['m', "86'", "0'"],
    ]);
  });

  it('rejects unsupported networks before requesting entropy', async () => {
    const request = setSnapMock();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_getAccounts',
        params: { network: 'unknownnet' },
      }),
    ).rejects.toThrow('supports regtest, signet, mutinynet, testnet4, and mainnet only');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_getBip32Entropy' }));
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('returns regtest account records from the development artifact', async () => {
    const development = loadDevelopmentRpc();
    const request = setSnapMock(true, { recentActions: [], selectedNetwork: 'regtest' });

    const accounts = await development.handleRpcRequest(DEV_ORIGIN, {
      method: 'ducat_getAccounts',
      params: { network: 'regtest' },
    });

    expect(accounts).toEqual(
      expect.objectContaining({
        sats: expect.objectContaining({ address: expect.stringMatching(/^bcrt1q/u) }),
        runes: expect.objectContaining({ address: expect.stringMatching(/^bcrt1p/u) }),
        vault: expect.objectContaining({ address: expect.stringMatching(/^bcrt1p/u) }),
      }),
    );
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('validates signPsbt params before requesting entropy', async () => {
    setSnapMock();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt: null, signInputs: {} },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('rejects message signing for unknown addresses', async () => {
    const request = setSnapMock();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signMessage',
        params: { network: 'signet', address: 'tb1qunknown', message: 'hello' },
      }),
    ).rejects.toThrow('not managed by the Ducat Snap');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('renders arbitrary message signing content as copyable confirmation data', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();
    const message = 'Sign in to Ducat with **literal markdown** and [link text](https://example.com)';

    const result = await handleRpcRequest(ORIGIN, {
      method: 'ducat_signMessage',
      params: { network: 'signet', address: keySet.record.sats.address, message },
    });
    const rendered = dialogValues(request).join('\n');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        result: expect.objectContaining({
          address: keySet.record.sats.address,
          protocol: 'BIP322',
          signature: expect.any(String),
        }),
      }),
    );
    expect(rendered).toContain('Message signing');
    expect(rendered).toContain('Message review');
    expect(rendered).toContain('Signing account');
    expect(rendered).toContain('Message fingerprint');
    expect(rendered).toContain('Message to sign');
    expect(rendered).toContain('Request details');
    expect(rendered).toContain('BIP322 simple');
    expect(rendered).toContain(message);
    expect(notificationMessages(request)).toEqual([
      'Review in MetaMask: Sign Ducat message - Message signature approval requested',
      'Ducat action complete: Sign Ducat message - Message signed',
    ]);
  });

  it('renders bounded primitive app metadata in message confirmations', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signMessage',
      params: {
        network: 'signet',
        address: keySet.record.sats.address,
        message: 'Authorize Ducat session',
        context: {
          metadata: {
            confirmations: 2,
            is_retry: false,
            vault_id: 'vault-alpha',
          },
        },
      },
    });

    const rendered = dialogValues(request).join('\n');

    expect(rendered).toContain('Ducat app context');
    expect(rendered).toContain('Confirmations');
    expect(rendered).toContain('2');
    expect(rendered).toContain('Is Retry');
    expect(rendered).toContain('false');
    expect(rendered).toContain('Vault Id');
    expect(rendered).toContain('vault-alpha');
  });

  it('escapes markdown syntax in app metadata so it cannot inject links into the dialog', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signMessage',
      params: {
        network: 'signet',
        address: keySet.record.sats.address,
        message: 'Authorize Ducat session',
        context: {
          metadata: {
            status: '[Verified](https://attacker.example)',
          },
        },
      },
    });

    const rendered = dialogValues(request).join('\n');

    expect(rendered).toContain('Ducat app context');
    // The literal characters survive, but escaped so MetaMask renders them as text, not a link.
    expect(rendered).toContain('\\[Verified\\]\\(https://attacker.example\\)');
    expect(rendered).not.toContain('[Verified](https://attacker.example)');
  });

  it('rejects context labels longer than the supported length before requesting entropy', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signMessage',
      params: {
        network: 'signet',
        address: keySet.record.sats.address,
        message: 'Authorize Ducat session',
        context: {
          title: 'x'.repeat(5_000),
        },
      },
    });

    const rendered = dialogValues(request).join('\n');

    // The oversized title is rejected by validation, so it never reaches the dialog title.
    expect(rendered).not.toContain('x'.repeat(5_000));
  });

  it('ignores structured app metadata instead of stringifying it into confirmations', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signMessage',
      params: {
        network: 'signet',
        address: keySet.record.sats.address,
        message: 'Authorize Ducat session',
        context: {
          actionType: 'borrow',
          metadata: {
            nested: { hostile: true },
          },
        },
      },
    });

    const rendered = dialogValues(request).join('\n');

    expect(rendered).not.toContain('Borrow UNIT');
    expect(rendered).not.toContain('Ducat app context');
    expect(rendered).not.toContain('Nested');
    expect(rendered).not.toContain('[object Object]');
  });

  it('rejects overlong messages before requesting entropy', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signMessage',
        params: { network: 'signet', address: keySet.record.sats.address, message: 'x'.repeat(801) },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({ maxMessageLength: 800 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_getBip32Entropy' }));
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects accountId on message signing in this release', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signMessage',
        params: {
          network: 'signet',
          accountId: 'imported-signet-1',
          address: keySet.record.sats.address,
          message: 'hello',
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_getBip32Entropy' }));
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects malformed PSBTs', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt: 'not-a-psbt', signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'MALFORMED_PSBT' });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('signs PSBTs with the active imported account without an account identifier', async () => {
    (invalidateWalletInventory as jest.Mock).mockClear();
    const imported = keyOverride();
    const request = setSnapMock(true, { recentActions: [], keyOverrides: [imported] });
    const { address, psbt } = makeImportedPsbt(100_000, 18, imported);

    const result = await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: {
        network: 'signet',
        psbt,
        signInputs: { [address]: [0] },
      },
    });

    expect(result).toEqual({ psbt: expect.any(String) });
    expect(invalidateWalletInventory).toHaveBeenCalledWith('signet');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_getBip32Entropy' }));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects PSBT signing when the confirmation is declined', async () => {
    setSnapMock(false);
    const { keySet, psbt } = makePsbt(100_000, 3);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'USER_REJECTED' });
  });

  it('renders Ducat action labels, parsed output facts, and app metadata in PSBT confirmations', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makeExternalPsbt(100_000, 9);

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: {
        network: 'signet',
        psbt,
        signInputs: { [keySet.record.sats.address]: [0] },
        context: {
          actionType: 'deposit',
          metadata: {
            intentId: 'wrap-123',
            expiresAt: '2026-08-11T20:00:00.000Z',
            finalAsset: 'wUNIT',
            evmRecipient: '0x1111111111111111111111111111111111111111',
          },
          vault: {
            effect: 'Adds BTC collateral to your existing vault.',
            amountSats: 100_000,
            collateralBeforeSats: 1_000_000,
            collateralAfterSats: 1_100_000,
            debtBeforeUnit: 500,
            debtAfterUnit: 500,
            healthBefore: 200,
            healthAfter: 220,
            liquidationPrice: 45_000,
          },
        },
      },
    });

    const rendered = dialogValues(request).join('\n');

    // The app claimed actionType 'deposit', but with no decodable Ducat OP_RETURN the Snap
    // cannot verify that, so the headline is tagged "(app-provided)" rather than presented as
    // an authoritative action (SAY-02).
    expect(rendered).toContain('Deposit BTC (app-provided)');
    // With no decodable Ducat OP_RETURN, app-supplied vault numbers must NOT be rendered as
    // an authoritative vault-state panel (they cannot be verified from the PSBT).
    expect(rendered).not.toContain('Updated vault state');
    expect(rendered).not.toContain('Adds BTC collateral to your existing vault.');
    expect(rendered).not.toContain('Health factor');
    expect(rendered).not.toContain('Liquidation threshold');
    expect(rendered).not.toContain('You are signing');
    expect(rendered).not.toContain('Effect');
    expect(rendered).not.toContain('Amount');
    expect(rendered).not.toContain('Vault status comes from the Ducat app.');
    // The trustworthy, PSBT-derived parts still render.
    expect(rendered).toContain('Approval summary');
    expect(rendered).toContain('Check collateral, change, and fee.');
    expect(rendered).toContain('You pay');
    expect(rendered).toContain('Recipient');
    expect(rendered).toContain('Change');
    expect(rendered).toContain('Signing check');
    expect(rendered).toContain('Ducat signs');
    expect(rendered).toContain('Only Snap-managed inputs');
    expect(rendered).toContain('Inspect signed inputs');
    expect(rendered).toContain('Input #0');
    expect(rendered).toContain('Inspect outputs');
    expect(rendered).not.toContain('Request details');
    expect(rendered).toContain('Ducat app context');
    expect(rendered).toContain('App-provided');
    expect(rendered).toContain('Intent Id');
    expect(rendered).toContain('wrap-123');
    expect(rendered).toContain('Expires At');
    expect(rendered).toContain('2026-08-11T20:00:00.000Z');
    expect(rendered).toContain('Final Asset');
    expect(rendered).toContain('wUNIT');
    expect(rendered).toContain('Evm Recipient');
    expect(rendered).toContain('0x1111111111111111111111111111111111111111');
  });

  it('renders decoded Ducat vault OP_RETURN facts in PSBT confirmations', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makeVaultReturnPsbt(2_000_000, 10);

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: {
        network: 'signet',
        psbt,
        signInputs: { [keySet.record.sats.address]: [0] },
        context: {
          actionType: 'withdraw',
          title: 'Withdraw BTC',
          vault: {
            amountSats: 99_999_999,
            amountUnit: 123,
            collateralAfterSats: 42,
            collateralBeforeSats: 1_000_000,
            debtBeforeUnit: 500,
            effect: 'Removes all BTC collateral from the vault.',
          },
        },
      },
    });

    const rendered = dialogValues(request).join('\n');

    expect(rendered).toContain('Deposit BTC');
    // This action IS verified from the decoded OP_RETURN, so the headline must not be tagged
    // "(app-provided)" (SAY-02 only marks unverifiable, non-vault actions).
    expect(rendered).not.toContain('(app-provided)');
    expect(rendered).toContain('Adds BTC collateral to the vault.');
    expect(rendered).toContain('decoded from vault data');
    expect(rendered).toContain('Collateral');
    expect(rendered).toContain('0.01100000 BTC');
    expect(rendered).toContain('UNIT debt');
    expect(rendered).toContain('500 UNIT');
    expect(rendered).not.toContain('Withdraw BTC');
    expect(rendered).not.toContain('Removes all BTC collateral from the vault.');
    expect(rendered).not.toContain('0.99999999 BTC');
    expect(rendered).not.toContain('123 UNIT');
    expect(rendered).not.toContain('Inspect data outputs');
    expect(rendered).not.toContain('Vault data #2');
    expect(rendered).not.toContain('Ducat app context');
    expect(rendered).not.toContain('Ducat OP_RETURN');
    expect(rendered).not.toContain('Vault Action Flag');
    expect(rendered).not.toContain('Request details');
  });

  it('labels signed vault inputs as multisig in PSBT confirmations', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makeVaultInputPsbt(100_000, 11);

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: {
        network: 'signet',
        psbt,
        signInputs: { [keySet.record.vault.address]: [0] },
      },
    });

    const rendered = dialogValues(request).join('\n');

    expect(rendered).toContain('Vault multisig');
    expect(rendered).toContain('Only Snap-managed inputs');
    expect(rendered).not.toContain('Warnings need review');
    expect(rendered).not.toContain('Alpha compatibility');
  });

  it('rejects unknown PSBT input indexes before showing confirmation', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makePsbt(100_000, 6);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [1] } },
      }),
    ).rejects.toMatchObject({
      code: 'PSBT_INPUT_INDEX_INVALID',
      details: expect.objectContaining({ inputIndex: 1 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects duplicate requested PSBT input indexes before requesting entropy', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makePsbt(100_000, 16);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0, 0] } },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({ inputIndex: 0 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_getBip32Entropy' }));
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects oversized PSBT signing requests before requesting entropy', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makePsbt(100_000, 17);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: Array.from({ length: 81 }, (_, index) => index) } },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({ maxSignInputs: 80 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_getBip32Entropy' }));
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('shows every external recipient when a PSBT has more than the former visible fold', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: Buffer.alloc(32, 19).toString('hex'),
      index: 0,
      witnessUtxo: { script: keySet.satsOutputScript, value: 1_000_000 },
    });
    // Nine distinct recipients prove the former eight-row display limit is gone.
    for (let index = 0; index < 9; index++) {
      const external = deriveAccountSetFromBaseNodes('signet', testNode(20 + index), testNode(40 + index));
      psbt.addOutput({ address: external.record.sats.address, value: 50_000 });
    }

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: { network: 'signet', psbt: psbt.toBase64(), signInputs: { [keySet.record.sats.address]: [0] } },
    });

    const section = collapsibleSection(dialogContent(request), 'Inspect outputs (9)');
    expect((section.props as Record<string, unknown>).isExpanded).toBe(true);
    expect(copyableValues(section)).toHaveLength(9);
  });

  it('shows an external recipient after leading change outputs', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: Buffer.alloc(32, 23).toString('hex'),
      index: 0,
      witnessUtxo: { script: keySet.satsOutputScript, value: 2_000_000 },
    });
    // Only ONE external recipient, but 8 change outputs to our own address come first, so the
    // recipient sits at non-data position 8 — outside the first-8 visible slice (SAY-07 follow-up:
    // counting external outputs alone (1 <= 8) would wrongly let this through).
    for (let index = 0; index < 8; index++) {
      psbt.addOutput({ address: keySet.record.sats.address, value: 10_000 });
    }
    const external = deriveAccountSetFromBaseNodes('signet', testNode(31), testNode(32));
    psbt.addOutput({ address: external.record.sats.address, value: 50_000 });

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: { network: 'signet', psbt: psbt.toBase64(), signInputs: { [keySet.record.sats.address]: [0] } },
    });

    const section = collapsibleSection(dialogContent(request), 'Inspect outputs (9)');
    expect(copyableValues(section)).toContain(external.record.sats.address);
  });

  it('shows every non-data output in the exact Admin reserve-issuance shape', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();
    const guardian = deriveAccountSetFromBaseNodes('signet', testNode(61), testNode(62));
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: Buffer.alloc(32, 63).toString('hex'),
      index: 0,
      witnessUtxo: { script: keySet.satsOutputScript, value: 2_000_000 },
    });
    psbt.addOutput({ address: keySet.record.runes.address, value: 10_000 });
    for (let index = 0; index < 10; index++) {
      psbt.addOutput({ address: guardian.record.runes.address, value: 100_000 });
    }
    psbt.addOutput({ script: btcScript.compile([opcodes.OP_RETURN, Buffer.from('RUNE')]), value: 0 });
    psbt.addOutput({ address: keySet.record.sats.address, value: 989_000 });

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: { network: 'signet', psbt: psbt.toBase64(), signInputs: { [keySet.record.sats.address]: [0] } },
    });

    const section = collapsibleSection(dialogContent(request), 'Inspect outputs (12)');
    const values = copyableValues(section);
    expect((section.props as Record<string, unknown>).isExpanded).toBe(true);
    expect(values).toEqual([
      keySet.record.runes.address,
      ...Array.from({ length: 10 }, () => guardian.record.runes.address),
      keySet.record.sats.address,
    ]);
    expect(dialogValues(request).join('\n')).not.toContain('more outputs');
  });

  it('itemizes distinct zero-value unknown scripts with full copyable hex', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });
    const scripts = Array.from({ length: 5 }, (_, index) => Buffer.from([opcodes.OP_1, index + 1]));

    psbt.addInput({
      hash: Buffer.alloc(32, 64).toString('hex'),
      index: 0,
      witnessUtxo: { script: keySet.satsOutputScript, value: 100_000 },
    });
    for (const script of scripts) {
      psbt.addOutput({ script, value: 0 });
    }
    psbt.addOutput({ address: keySet.record.sats.address, value: 99_000 });

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: { network: 'signet', psbt: psbt.toBase64(), signInputs: { [keySet.record.sats.address]: [0] } },
    });

    const section = collapsibleSection(dialogContent(request), 'Inspect outputs (6)');
    expect(copyableValues(section)).toEqual([...scripts.map((script) => script.toString('hex')), keySet.record.sats.address]);
    expect(dialogValues(request).join('\n')).not.toContain('more data outputs');
  });

  it('validates and measures the complete 120-output confirmation tree', async () => {
    const request = setSnapMock();
    const external = deriveAccountSetFromBaseNodes('signet', testNode(65), testNode(66));
    const fixture = makeOutputBoundPsbt(120, 65, external.record.runes.address);

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signPsbt',
      params: { network: 'signet', psbt: fixture.psbt, signInputs: { [fixture.keySet.record.sats.address]: [0] } },
    });

    const content = dialogContent(request);
    const section = collapsibleSection(content, 'Inspect outputs (120)');
    const jsonLength = validateCapturedTree(content, '120-output single confirmation');
    expect(copyableValues(section)).toEqual(Array.from({ length: 120 }, () => external.record.runes.address));
    expect({ label: '120-output single confirmation', jsonLength }).toEqual({
      label: '120-output single confirmation',
      jsonLength: expect.any(Number),
    });
  });

  it('retains the 121-output parser rejection before confirmation', async () => {
    const request = setSnapMock();
    const external = deriveAccountSetFromBaseNodes('signet', testNode(67), testNode(68));
    const fixture = makeOutputBoundPsbt(121, 67, external.record.runes.address);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt: fixture.psbt, signInputs: { [fixture.keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'PSBT_TOO_LARGE', details: expect.objectContaining({ maxOutputs: 120, outputCount: 121 }) });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects structurally valid oversized single confirmation content before snap_dialog', async () => {
    const request = setSnapMock();
    const oversizedIdentity = 'ab'.repeat(5_000_001);
    const structurallyValidOverLimitTree = uiBox([uiCopyable(oversizedIdentity)]);

    ComponentOrElementStruct.assert(structurallyValidOverLimitTree);
    validateJsxElements(structurallyValidOverLimitTree, {
      isOnPhishingList: () => false,
      getSnap: () => null,
      getAccountByAddress: () => undefined,
      hasPermission: () => true,
    });
    expect(getJsonSizeUnsafe(structurallyValidOverLimitTree)).toBeGreaterThan(10_000_000);

    await expect(
      confirmPsbt({
        origin: ORIGIN,
        summary: summaryWithOutputs([
          { address: 'Unknown script', scriptHex: oversizedIdentity, valueSats: 0, isMine: false, role: 'unknown' },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_UI_TOO_LARGE' });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('batch signing preserves PSBT order', async () => {
    (invalidateWalletInventory as jest.Mock).mockClear();
    setSnapMock();
    const first = makePsbt(100_000, 4);
    const second = makePsbt(200_000, 5);

    const result = (await handleRpcRequest(ORIGIN, {
      method: 'ducat_signBatch',
      params: {
        network: 'signet',
        entries: [
          { psbt: first.psbt, signInputs: { [first.keySet.record.sats.address]: [0] } },
          { psbt: second.psbt, signInputs: { [second.keySet.record.sats.address]: [0] } },
        ],
      },
    })) as { psbts: string[] };

    expect(result.psbts).toHaveLength(2);
    expect(invalidateWalletInventory).toHaveBeenCalledWith('signet');
    expect(Psbt.fromBase64(result.psbts[0], { network: bitcoinNetwork('signet') }).txOutputs[0].value).toBe(99_000);
    expect(Psbt.fromBase64(result.psbts[1], { network: bitcoinNetwork('signet') }).txOutputs[0].value).toBe(199_000);
  });

  it('itemizes recipients in batch entries seven through ten', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();
    const recipients: string[] = [];
    const entries = Array.from({ length: 10 }, (_, index) => {
      const external = deriveAccountSetFromBaseNodes('signet', testNode(70 + index), testNode(90 + index));
      const psbt = new Psbt({ network: bitcoinNetwork('signet') });
      recipients.push(external.record.runes.address);
      psbt.addInput({
        hash: Buffer.alloc(32, 70 + index).toString('hex'),
        index: 0,
        witnessUtxo: { script: keySet.satsOutputScript, value: 100_000 },
      });
      psbt.addOutput({ address: external.record.runes.address, value: 99_000 });

      return { psbt: psbt.toBase64(), signInputs: { [keySet.record.sats.address]: [0] } };
    });

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signBatch',
      params: { network: 'signet', entries },
    });

    const section = collapsibleSection(dialogContent(request), 'Inspect transactions (10)');
    expect((section.props as Record<string, unknown>).isExpanded).toBe(true);
    expect(copyableValues(section)).toEqual(recipients);
    expect(dialogValues(request).join('\n')).not.toContain('not itemized');
  });

  it('classifies interleaved batch outputs without hiding external identities', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();
    const external = deriveAccountSetFromBaseNodes('signet', testNode(101), testNode(102));
    const unknownScript = Buffer.from([opcodes.OP_1, 0x2a]);
    const psbt = new Psbt({ network: bitcoinNetwork('signet') });

    psbt.addInput({
      hash: Buffer.alloc(32, 103).toString('hex'),
      index: 0,
      witnessUtxo: { script: keySet.satsOutputScript, value: 100_000 },
    });
    psbt.addOutput({ address: keySet.record.sats.address, value: 20_000 });
    psbt.addOutput({ script: btcScript.compile([opcodes.OP_RETURN, Buffer.from('RUNE')]), value: 0 });
    psbt.addOutput({ address: external.record.runes.address, value: 30_000 });
    psbt.addOutput({ script: unknownScript, value: 0 });

    await handleRpcRequest(ORIGIN, {
      method: 'ducat_signBatch',
      params: {
        network: 'signet',
        entries: [{ psbt: psbt.toBase64(), signInputs: { [keySet.record.sats.address]: [0] } }],
      },
    });

    const section = collapsibleSection(dialogContent(request), 'Inspect transactions (1)');
    expect(copyableValues(section)).toEqual([external.record.runes.address, unknownScript.toString('hex')]);
  });

  it('validates and measures every destination in a ten-by-120 batch tree', async () => {
    const request = setSnapMock();
    const recipients: string[] = [];
    const entries = Array.from({ length: 10 }, (_, index) => {
      const external = deriveAccountSetFromBaseNodes('signet', testNode(110 + index), testNode(130 + index));
      const fixture = makeOutputBoundPsbt(120, 110 + index, external.record.runes.address);
      recipients.push(...Array.from({ length: 120 }, () => external.record.runes.address));

      return { psbt: fixture.psbt, signInputs: { [fixture.keySet.record.sats.address]: [0] } };
    });

    await handleRpcRequest(ORIGIN, { method: 'ducat_signBatch', params: { network: 'signet', entries } });

    const content = dialogContent(request);
    const section = collapsibleSection(content, 'Inspect transactions (10)');
    const jsonLength = validateCapturedTree(content, 'ten-by-120 batch confirmation');
    expect(copyableValues(section)).toEqual(recipients);
    expect({ label: 'ten-by-120 batch confirmation', jsonLength }).toEqual({
      label: 'ten-by-120 batch confirmation',
      jsonLength: expect.any(Number),
    });
  });

  it('validates the complete near-maximum accepted batch payload tree', async () => {
    const request = setSnapMock();
    const expectedScripts: string[] = [];
    const entries = Array.from({ length: 10 }, (_, index) => {
      const fixture = makeNearMaximumPayloadPsbt(150 + index);
      expectedScripts.push(...fixture.scripts);

      return { psbt: fixture.psbt, signInputs: { [fixture.keySet.record.sats.address]: [0] } };
    });

    await handleRpcRequest(ORIGIN, { method: 'ducat_signBatch', params: { network: 'signet', entries } });

    const content = dialogContent(request);
    const section = collapsibleSection(content, 'Inspect transactions (10)');
    const jsonLength = validateCapturedTree(content, 'near-maximum ten-PSBT batch confirmation');
    expect(copyableValues(section)).toEqual(expectedScripts);
    expect(jsonLength).toBeGreaterThan(5_000_000);
  });

  it('rejects oversized batch confirmation content before snap_dialog', async () => {
    const request = setSnapMock();
    const oversizedIdentity = 'cd'.repeat(5_000_001);

    await expect(
      confirmBatch({
        origin: ORIGIN,
        entries: [
          {
            summary: summaryWithOutputs([
              { address: 'Unknown script', scriptHex: oversizedIdentity, valueSats: 0, isMine: false, role: 'unknown' },
            ]),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_UI_TOO_LARGE' });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects a batch whose entries spend the same outpoint before confirmation', async () => {
    const request = setSnapMock();
    // Same seed => same prevout hash:vout across both entries (SAY-04).
    const first = makePsbt(100_000, 9);
    const second = makePsbt(200_000, 9);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signBatch',
        params: {
          network: 'signet',
          entries: [
            { psbt: first.psbt, signInputs: { [first.keySet.record.sats.address]: [0] } },
            { psbt: second.psbt, signInputs: { [second.keySet.record.sats.address]: [0] } },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: 'BATCH_CONFLICTING_OUTPOINT',
      details: expect.objectContaining({ entryIndex: 1, conflictsWithEntry: 0 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('batch signing rejects the whole batch before confirmation when one entry is invalid', async () => {
    const request = setSnapMock();
    const first = makePsbt(100_000, 7);
    const second = makePsbt(200_000, 8);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signBatch',
        params: {
          network: 'signet',
          entries: [
            { psbt: first.psbt, signInputs: { [first.keySet.record.sats.address]: [0] } },
            { psbt: second.psbt, signInputs: { [second.keySet.record.sats.address]: [1] } },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: 'PSBT_INPUT_INDEX_INVALID',
      details: expect.objectContaining({ inputIndex: 1 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects oversized batches before requesting entropy', async () => {
    const request = setSnapMock();
    const entries = Array.from({ length: 11 }, () => ({
      psbt: 'placeholder',
      signInputs: { tb1qplaceholder: [0] },
    }));

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signBatch',
        params: { network: 'signet', entries },
      }),
    ).rejects.toMatchObject({
      code: 'BATCH_ENTRY_INVALID',
      details: expect.objectContaining({ maxBatchEntries: 10 }),
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_getBip32Entropy' }));
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('renders Snap Home from the last connected network and origin', async () => {
    const request = setSnapMock(true, {
      recentActions: [
        {
          id: 'recent-borrow',
          actionType: 'borrow',
          title: 'Borrow UNIT',
          network: 'signet',
          origin: 'https://dev.app.ducatprotocol.com',
          timestamp: Date.now() - 60_000,
          status: 'broadcast',
          txid: 'a'.repeat(64),
          summary: 'Borrowed UNIT against Alpha vault',
          amountSats: 12_345,
          unitAmount: 100,
          details: {
            vault_id: 'vault-1',
          },
        },
      ],
      selectedNetwork: 'signet',
      lastOrigin: 'https://dev.app.ducatprotocol.com',
    });
    const fetchMock = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);

      if (href.includes('mempool.space/signet/api/address/')) {
        return new Response(
          JSON.stringify({
            chain_stats: { funded_txo_sum: 50_000, spent_txo_sum: 10_000 },
            mempool_stats: { funded_txo_sum: 5_000, spent_txo_sum: 0 },
          }),
          { status: 200 },
        );
      }

      if (href.includes('validator-testnet4.dev.ducatprotocol.com/api/address/')) {
        return new Response(JSON.stringify({ data: [{ asset_balance: 12345 }] }), { status: 200 });
      }

      if (href.includes('validator-testnet4.dev.ducatprotocol.com/api/vault/pubkey/')) {
        return new Response(
          JSON.stringify({
            data: [],
            items: [
              {
                root_txid: 'vault-1',
                thold_price: 40_000,
                unit_balance: 100_000,
                unit_price: 100_000,
                vault_action: 'active',
                vault_balance: 50_000_000,
                vault_config: { label: 'Alpha vault' },
                vault_ratio: 6.233342137488894,
              },
            ],
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected fetch ${href} ${init?.method ?? 'GET'}`);
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await handleRpcRequest('https://dev.app.ducatprotocol.com', {
        method: 'ducat_getAccounts',
        params: { network: 'signet' },
      });

      const keySet = testKeySet();
      const home = await renderHomePage();
      expect(home).toEqual({ id: 'interface-1' });
      const rendered = JSON.stringify(request.interfaces.get('interface-1'));

      expect(rendered).toContain('signet');
      expect(rendered).toContain('Manage');
      expect(rendered).not.toContain(truncateMiddle(keySet.record.sats.address));
      expect(rendered).not.toContain(truncateMiddle(keySet.record.runes.address));
      expect(rendered).toContain(keySet.record.sats.address);
      expect(rendered).toContain(keySet.record.runes.address);
      expect(rendered).toContain(keySet.record.sats.pubkey);
      expect(rendered).toContain('manage-key');
      expect(rendered).toContain('https://validator-testnet4.dev.ducatprotocol.com');
      expect(rendered).toContain('manage-validator');
      expect(rendered).toContain('https://mempool.space/signet/api');
      expect(rendered).toContain('manage-esplora');
      expect(occurrenceCount(rendered, keySet.record.sats.address)).toBe(1);
      expect(occurrenceCount(rendered, keySet.record.runes.address)).toBe(1);
      expect(rendered).not.toContain('mainnet enabled');
      expect(rendered).not.toContain('Balance lookups contact external services');
      expect(rendered).toContain('12345 sats');
      expect(rendered).toContain('10000 active / 0 reserved');
      expect(rendered).not.toContain('Alpha vault');
      expect(rendered).toContain('Bitcoin public key');
      expect(rendered).not.toContain('Bitcoin private key');
      expect(rendered).not.toContain('Network endpoints');
      expect(rendered).not.toContain('Account management');
      expect(rendered).not.toContain('Accounts');
      expect(rendered).not.toContain('Label');
      expect(rendered).not.toContain('Recent Ducat actions');
      expect(rendered).not.toContain('Open Ducat app');
      expect(rendered).not.toContain('Ducat actions');
      expect(rendered).not.toContain('https://dev.app.ducatprotocol.com/?action=deposit');
      expect(rendered).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('renders Snap Home addresses from the imported override account', async () => {
    const override = keyOverride(9);
    const derived = testKeySet();
    const request = setSnapMock(true, {
      recentActions: [],
      keyOverrides: [override],
      selectedNetwork: 'signet',
      lastOrigin: 'https://dev.app.ducatprotocol.com',
    });
    const fetchMock = jest.fn(async (url: RequestInfo | URL) => {
      const href = String(url);

      if (href.includes(`/address/${override.sats.address}`) || href.includes(`/address/${override.runes.address}`)) {
        return new Response(JSON.stringify({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } }), { status: 200 });
      }

      if (href.includes('validator-testnet4.dev.ducatprotocol.com/api/vault/pubkey/')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      throw new Error(`Unexpected fetch ${href}`);
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const home = await renderHomePage();
      expect(home).toEqual({ id: 'interface-1' });
      const rendered = JSON.stringify(request.interfaces.get('interface-1'));

      expect(rendered).toContain(override.sats.address);
      expect(rendered).toContain(override.runes.address);
      expect(rendered).toContain(override.sats.pubkey);
      expect(rendered).not.toContain(derived.record.sats.address);
      expect(rendered).not.toContain(derived.record.runes.address);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('treats malformed Snap Home network balances as unavailable', async () => {
    const request = setSnapMock(true, {
      recentActions: [],
      selectedNetwork: 'signet',
      lastOrigin: 'https://dev.app.ducatprotocol.com',
    });
    const fetchMock = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);

      if (href.includes('mempool.space/signet/api/address/')) {
        return new Response(
          JSON.stringify({
            chain_stats: { funded_txo_sum: 10_000, spent_txo_sum: 20_000 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          }),
          { status: 200 },
        );
      }

      if (href.includes('validator-testnet4.dev.ducatprotocol.com/api/address/')) {
        return new Response(JSON.stringify({ data: [null] }), { status: 200 });
      }

      if (href.includes('validator-testnet4.dev.ducatprotocol.com/api/vault/pubkey/')) {
        return new Response(JSON.stringify([null, {
          root_txid: 'vault-invalid',
          thold_price: -40_000,
          unit_balance: -1_000,
          unit_price: -100_000,
          vault_action: 'active',
          vault_balance: -50_000_000,
          vault_ratio: -6,
        }]), { status: 200 });
      }

      throw new Error(`Unexpected fetch ${href} ${init?.method ?? 'GET'}`);
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = fetchMock as typeof fetch;

    try {
      (getWalletInventory as jest.Mock).mockRejectedValueOnce(new Error('malformed remote payload'));
      const home = await renderHomePage();
      expect(home).toEqual({ id: 'interface-1' });
      const rendered = JSON.stringify(request.interfaces.get('interface-1'));

      expect(rendered).toContain('Wallet data unavailable');
      expect(rendered).toContain('BTC');
      expect(rendered).toContain('Unavailable');
      expect(rendered).toContain('UNIT');
      expect(rendered).toContain('Message signing remains available');
      expect(rendered).not.toContain('Vault');
      expect(rendered).not.toContain('-0.5');
      expect(rendered).not.toContain('-1,000');
      expect(rendered).not.toContain('$-');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
