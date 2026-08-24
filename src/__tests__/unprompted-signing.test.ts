// Tests for the dev-only unprompted signing path (`ducat_signPsbtUnprompted`).
//
// Security contract this file pins:
//   1. PRODUCTION (DUCAT_SNAP_DEV_UNPROMPTED unset/false): the method does not exist — it is
//      reported as METHOD_NOT_FOUND, indistinguishable from any unknown method. No prompt is
//      skipped because the path is unreachable.
//   2. DEV (DUCAT_SNAP_DEV_UNPROMPTED=true): the method signs WITHOUT a snap_dialog confirmation
//      on non-mainnet networks...
//   3. ...but every mainnet-backed deployment is refused by the development artifact policy, and
//      no signing occurs.
//   4. The normal `ducat_signPsbt` ALWAYS shows the dialog regardless of the build flag.
//
// `DEV_UNPROMPTED_ENABLED` is evaluated at module load from process.env, so each scenario loads
// a fresh copy of ../rpc with the env set accordingly via jest.isolateModules.

import { Psbt } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { bitcoinNetwork } from '../networks';

jest.mock('../psbt-verification', () => ({
  createPsbtVerificationContext: jest.fn(async () => ({ verify: jest.fn(async () => undefined) })),
}));

const ORIGIN = 'https://app.ducatprotocol.com';
const DEV_ORIGIN = 'http://localhost:3000';

function testNode(byte: number) {
  return DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
}

function testKeySet() {
  return deriveAccountSetFromBaseNodes('signet', testNode(1), testNode(2));
}

function setSnapMock(dialogResult = true, selectedNetwork: 'signet' | 'mainnet' = 'signet') {
  let managedState: unknown = { recentActions: [], selectedNetwork };
  const request = jest.fn(async ({ method, params }: { method: string; params?: { operation?: string; path?: string[]; newState?: unknown } }) => {
    if (method === 'snap_getBip32Entropy') {
      const byte = params?.path?.[1] === "84'" ? 1 : 2;
      return { privateKey: Buffer.alloc(32, byte).toString('hex'), chainCode: Buffer.alloc(32, byte + 10).toString('hex') };
    }
    if (method === 'snap_dialog') {
      return dialogResult;
    }
    if (method === 'snap_manageState') {
      if (params?.operation === 'get') {
        return managedState;
      }
      managedState = params?.newState ?? null;
      return undefined;
    }
    if (method === 'snap_notify') {
      return undefined;
    }
    throw new Error(`Unexpected Snap method ${method}`);
  });
  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };
  return request;
}

function makeSignablePsbt(value: number, seed: number) {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });
  psbt.addInput({
    hash: Buffer.alloc(32, seed).toString('hex'),
    index: 0,
    witnessUtxo: { script: keySet.satsOutputScript, value },
  });
  psbt.addOutput({ address: keySet.record.sats.address, value: value - 1_000 });
  return { keySet, psbt: psbt.toBase64() };
}

function makeUnknownFeePsbt() {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });
  psbt.addInput({
    hash: Buffer.alloc(32, 6).toString('hex'),
    index: 0,
    witnessUtxo: { script: keySet.satsOutputScript, value: 100_000 },
  });
  psbt.addInput({ hash: Buffer.alloc(32, 7).toString('hex'), index: 0 });
  psbt.addOutput({ address: keySet.record.sats.address, value: 90_000 });
  return { keySet, psbt: psbt.toBase64() };
}

function dialogWasShown(request: ReturnType<typeof setSnapMock>): boolean {
  return request.mock.calls.some(([arg]) => (arg as { method: string }).method === 'snap_dialog');
}

// Load ../rpc fresh with DUCAT_SNAP_DEV_UNPROMPTED set to the given value (or unset).
function loadRpcWithFlag(value: 'true' | 'false' | undefined): { handleRpcRequest: typeof import('../rpc').handleRpcRequest; DEV_UNPROMPTED_ENABLED: boolean } {
  const previous = {
    policy: process.env.DUCAT_SNAP_ARTIFACT_POLICY,
    origins: process.env.DUCAT_SNAP_DEV_ORIGINS,
    unprompted: process.env.DUCAT_SNAP_DEV_UNPROMPTED,
    debug: process.env.DUCAT_SNAP_DEBUG,
  };
  process.env.DUCAT_SNAP_ARTIFACT_POLICY = value === 'true' ? 'development' : 'production';
  process.env.DUCAT_SNAP_DEBUG = 'false';
  if (value === 'true') process.env.DUCAT_SNAP_DEV_ORIGINS = DEV_ORIGIN;
  else delete process.env.DUCAT_SNAP_DEV_ORIGINS;
  if (value === undefined) {
    delete process.env.DUCAT_SNAP_DEV_UNPROMPTED;
  } else {
    process.env.DUCAT_SNAP_DEV_UNPROMPTED = value;
  }

  jest.resetModules();
  const mod = require('../rpc') as typeof import('../rpc');

  for (const [name, previousValue] of [
    ['DUCAT_SNAP_ARTIFACT_POLICY', previous.policy],
    ['DUCAT_SNAP_DEV_ORIGINS', previous.origins],
    ['DUCAT_SNAP_DEV_UNPROMPTED', previous.unprompted],
    ['DUCAT_SNAP_DEBUG', previous.debug],
  ] as const) {
    if (previousValue === undefined) delete process.env[name];
    else process.env[name] = previousValue;
  }
  jest.resetModules();
  return { handleRpcRequest: mod.handleRpcRequest, DEV_UNPROMPTED_ENABLED: mod.DEV_UNPROMPTED_ENABLED };
}

describe('unprompted signing — production build (flag off)', () => {
  it('DEV_UNPROMPTED_ENABLED is false when the env var is unset', () => {
    expect(loadRpcWithFlag(undefined).DEV_UNPROMPTED_ENABLED).toBe(false);
  });

  it('rejects ducat_signPsbtUnprompted as an unknown method (path is absent)', async () => {
    const { handleRpcRequest } = loadRpcWithFlag(undefined);
    setSnapMock();
    const { keySet, psbt } = makeSignablePsbt(100_000, 1);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbtUnprompted',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('does not sign or skip the dialog when the method is rejected in prod', async () => {
    const { handleRpcRequest } = loadRpcWithFlag('false');
    const request = setSnapMock();
    const { keySet, psbt } = makeSignablePsbt(100_000, 2);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbtUnprompted',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
    expect(dialogWasShown(request)).toBe(false); // nothing happened at all
  });
});

describe('unprompted signing — dev build (flag on)', () => {
  it('DEV_UNPROMPTED_ENABLED is true when the env var is "true"', () => {
    expect(loadRpcWithFlag('true').DEV_UNPROMPTED_ENABLED).toBe(true);
  });

  it('signs a signet PSBT WITHOUT showing the confirmation dialog', async () => {
    const { handleRpcRequest } = loadRpcWithFlag('true');
    const request = setSnapMock();
    const { keySet, psbt } = makeSignablePsbt(100_000, 3);

    const result = (await handleRpcRequest(DEV_ORIGIN, {
      method: 'ducat_signPsbtUnprompted',
      params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
    })) as { psbt: string };

    // Produced a signed PSBT...
    const signed = Psbt.fromBase64(result.psbt, { network: bitcoinNetwork('signet') });
    expect(signed.data.inputs[0].partialSig).toHaveLength(1);
    // ...without ever asking the user.
    expect(dialogWasShown(request)).toBe(false);
  });

  it('rejects an unknown miner fee without showing a dialog or signing', async () => {
    const { handleRpcRequest } = loadRpcWithFlag('true');
    const request = setSnapMock();
    const { keySet, psbt } = makeUnknownFeePsbt();

    await expect(
      handleRpcRequest(DEV_ORIGIN, {
        method: 'ducat_signPsbtUnprompted',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({ code: 'PSBT_FEE_UNAVAILABLE' });
    expect(dialogWasShown(request)).toBe(false);
  });

  it('refuses mainnet through the development artifact policy before signing', async () => {
    const { handleRpcRequest } = loadRpcWithFlag('true');
    const request = setSnapMock(true, 'mainnet');
    const { keySet, psbt } = makeSignablePsbt(100_000, 4);

    await expect(
      handleRpcRequest(DEV_ORIGIN, {
        method: 'ducat_signPsbtUnprompted',
        params: { network: 'mainnet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toMatchObject({
      code: 'DEPLOYMENT_NOT_AVAILABLE',
      details: { artifactPolicy: 'development', deploymentId: 'mainnet' },
    });
    expect(dialogWasShown(request)).toBe(false);
  });

  it('still requires the dialog for the normal ducat_signPsbt method even when the flag is on', async () => {
    const { handleRpcRequest } = loadRpcWithFlag('true');
    const request = setSnapMock();
    const { keySet, psbt } = makeSignablePsbt(100_000, 5);

    await handleRpcRequest(DEV_ORIGIN, {
      method: 'ducat_signPsbt',
      params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
    });

    expect(dialogWasShown(request)).toBe(true);
  });
});
