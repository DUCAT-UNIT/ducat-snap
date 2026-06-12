import { Psbt } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { bitcoinNetwork } from '../networks';
import { handleRpcRequest } from '../rpc';

const ORIGIN = 'http://localhost:3000';

type SnapRequestArgs = {
  method: string;
  params?: {
    operation?: string;
    path?: string[];
  };
};

function testNode(byte: number) {
  return DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
}

function testKeySet() {
  return deriveAccountSetFromBaseNodes('signet', testNode(1), testNode(2));
}

function setSnapMock(dialogResult = true) {
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
      return params?.operation === 'get' ? null : undefined;
    }

    throw new Error(`Unexpected Snap method ${method}`);
  });

  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };

  return request;
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

describe('RPC router', () => {
  it('rejects unknown RPC methods', async () => {
    await expect(handleRpcRequest(ORIGIN, { method: 'ducat_unknown' })).rejects.toThrow('Method not found');
  });

  it('rejects unauthorized origins before requesting entropy', async () => {
    const request = setSnapMock();

    await expect(handleRpcRequest('https://evil.example', { method: 'ducat_getAccounts', params: { network: 'signet' } })).rejects.toThrow(
      'not authorized',
    );
    expect(request).not.toHaveBeenCalled();
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
  });

  it('rejects unsupported networks before requesting entropy', async () => {
    const request = setSnapMock();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_getAccounts',
        params: { network: 'mainnet' },
      }),
    ).rejects.toThrow('supports signet and mutinynet only');
    expect(request).not.toHaveBeenCalled();
  });

  it('validates signPsbt params before requesting entropy', async () => {
    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt: null, signInputs: {} },
      }),
    ).rejects.toThrow('requires psbt and signInputs');
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
    const dialogCall = request.mock.calls.find(([arg]) => arg.method === 'snap_dialog');

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
    expect(dialogCall?.[0].params).toEqual(
      expect.objectContaining({
        content: expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              type: 'copyable',
              value: message,
            }),
          ]),
        }),
      }),
    );
  });

  it('rejects malformed PSBTs', async () => {
    const request = setSnapMock();
    const keySet = testKeySet();

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt: 'not-a-psbt', signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toThrow('Malformed PSBT');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('rejects PSBT signing when the confirmation is declined', async () => {
    setSnapMock(false);
    const { keySet, psbt } = makePsbt(100_000, 3);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [0] } },
      }),
    ).rejects.toThrow('User rejected Ducat transaction signing');
  });

  it('rejects unknown PSBT input indexes before showing confirmation', async () => {
    const request = setSnapMock();
    const { keySet, psbt } = makePsbt(100_000, 6);

    await expect(
      handleRpcRequest(ORIGIN, {
        method: 'ducat_signPsbt',
        params: { network: 'signet', psbt, signInputs: { [keySet.record.sats.address]: [1] } },
      }),
    ).rejects.toThrow('Invalid PSBT input index 1');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });

  it('batch signing preserves PSBT order', async () => {
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
    expect(Psbt.fromBase64(result.psbts[0], { network: bitcoinNetwork('signet') }).txOutputs[0].value).toBe(99_000);
    expect(Psbt.fromBase64(result.psbts[1], { network: bitcoinNetwork('signet') }).txOutputs[0].value).toBe(199_000);
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
    ).rejects.toThrow('Invalid PSBT input index 1');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'snap_dialog' }));
  });
});
