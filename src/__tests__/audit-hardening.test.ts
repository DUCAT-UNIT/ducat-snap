import { Psbt } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { actionLabel } from '../display';
import { handleRpcRequest } from '../rpc';
import { bitcoinNetwork } from '../networks';

jest.mock('../psbt-verification', () => ({
  createPsbtVerificationContext: jest.fn(async () => ({ verify: jest.fn(async () => undefined) })),
}));

const ORIGIN = 'https://app.ducatprotocol.com';

type SnapRequestArgs = {
  method: string;
  params?: { key?: string; operation?: string; path?: string[]; value?: unknown };
};

function testNode(byte: number) {
  return DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
}

function testKeySet() {
  return deriveAccountSetFromBaseNodes('signet', testNode(1), testNode(2));
}

function setSnapMock(dialogResult = true) {
  let managedState: unknown = { recentActions: [], selectedNetwork: 'signet' };
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

    throw new Error(`Unexpected Snap method ${method}`);
  });

  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };

  return request;
}

function dialogCalled(request: jest.Mock): boolean {
  return request.mock.calls.some(([arg]) => arg.method === 'snap_dialog');
}

/**
 * A PSBT with one Snap-owned, value-bearing input the app asks to sign, plus a second input that
 * omits witnessUtxo. The second input's value is unknown, so summarizePsbt cannot compute the
 * total miner fee (feeSats === null).
 */
function makeUncomputableFeePsbt() {
  const keySet = testKeySet();
  const psbt = new Psbt({ network: bitcoinNetwork('signet') });

  psbt.addInput({
    hash: Buffer.alloc(32, 1).toString('hex'),
    index: 0,
    witnessUtxo: { script: keySet.satsOutputScript, value: 100_000 },
  });
  // Second input has no witnessUtxo -> its value is unknown -> fee is uncomputable.
  psbt.addInput({
    hash: Buffer.alloc(32, 2).toString('hex'),
    index: 0,
  });
  psbt.addOutput({ address: keySet.record.sats.address, value: 90_000 });

  return { keySet, psbt: psbt.toBase64() };
}

describe('Audit hardening: null-fee hard-stop (finding #1)', () => {
  it('refuses to sign a PSBT whose total fee cannot be computed, before showing the dialog', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makeUncomputableFeePsbt();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: {
          network: 'signet',
          psbt,
          signInputs: { [keySet.record.sats.address]: [0] },
        },
      }),
    ).rejects.toMatchObject({ code: 'PSBT_FEE_UNAVAILABLE' });

    // The hard-stop must happen before any confirmation dialog is rendered.
    expect(dialogCalled(request)).toBe(false);
  });

  it('refuses a batch when any entry has an uncomputable fee', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makeUncomputableFeePsbt();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signBatch',
        params: {
          network: 'signet',
          entries: [{ psbt, signInputs: { [keySet.record.sats.address]: [0] } }],
        },
      }),
    ).rejects.toMatchObject({ code: 'PSBT_FEE_UNAVAILABLE' });

    expect(dialogCalled(request)).toBe(false);
  });
});

describe('Audit hardening: action-label sanitization (finding #2)', () => {
  it('strips Unicode bidi/control characters from a dapp-supplied title', () => {
    // U+202E (right-to-left override) + zero-width space embedded in an app title.
    const malicious = 'Depos‮it​ BTC';
    const label = actionLabel({ title: malicious });

    expect(label).not.toMatch(/[‪-‮⁦-⁩​]/u);
    expect(label).not.toContain('‮');
    // The legible characters survive; only the invisible/formatting ones are removed.
    expect(label).toContain('Deposit');
  });

  it('still maps known action keys to their safe constant labels', () => {
    expect(actionLabel({ actionType: 'borrow' })).toBe('Borrow UNIT');
    expect(actionLabel({ actionType: 'withdraw' })).toBe('Withdraw BTC');
  });

  it('falls back to the provided default when no label is supplied', () => {
    expect(actionLabel(undefined, 'Ducat transaction')).toBe('Ducat transaction');
  });
});
