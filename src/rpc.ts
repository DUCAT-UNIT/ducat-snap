import { getAccountKeySet, getRoleForAddress } from './accounts';
import { confirmBatch, confirmMessage, confirmPsbt } from './confirmations';
import { getHomeState } from './home';
import { signBip322SimpleMessage } from './message';
import { normalizeNetwork } from './networks';
import { preparePsbtForSigning, signPreparedPsbt } from './psbt';
import { appendRecentAction } from './state';
import { sendTransfer } from './transfer';
import type { DucatActionContext, SignInputs } from './types';

type JsonRpcRequest = {
  method: string;
  params?: unknown;
};

type SignPsbtParams = {
  network?: unknown;
  psbt?: unknown;
  signInputs?: unknown;
  context?: DucatActionContext;
};

type SignBatchParams = {
  network?: unknown;
  entries?: unknown;
  context?: DucatActionContext;
};

type SignMessageParams = {
  network?: unknown;
  address?: unknown;
  message?: unknown;
  context?: DucatActionContext;
};

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'https://app.ducatprotocol.com',
  'https://dev.app.ducatprotocol.com',
  'https://staging.app.ducatprotocol.com',
]);

function assertAllowedOrigin(origin: string): void {
  if (!ALLOWED_ORIGINS.has(origin)) {
    throw new Error(`Origin not authorized for Ducat Snap: ${origin}`);
  }
}

function isSignInputs(value: unknown): value is SignInputs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((indexes) => Array.isArray(indexes) && indexes.every((index) => Number.isInteger(index)));
}

function paramsObject<T extends object>(params: unknown): Partial<T> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {};
  }

  return params as Partial<T>;
}

async function signMessage(origin: string, rawParams: unknown) {
  const params = paramsObject<SignMessageParams>(rawParams);
  const network = normalizeNetwork(params.network);
  const address = typeof params.address === 'string' ? params.address : '';
  const message = typeof params.message === 'string' ? params.message : '';

  if (!address || !message) {
    throw new Error('ducat_signMessage requires address and message.');
  }

  const keySet = await getAccountKeySet(network);
  const role = getRoleForAddress(keySet, address);

  if (!role) {
    throw new Error(`Address ${address} is not managed by the Ducat Snap.`);
  }

  await confirmMessage({ origin, network, address, message, context: params.context });

  const signature = signBip322SimpleMessage({
    keySet,
    role,
    message,
  });

  await appendRecentAction({
    actionType: params.context?.actionType ?? 'sign-message',
    network,
    origin,
    summary: `Signed message for ${address}`,
  });

  return {
    status: 'success',
    result: {
      address,
      messageHash: '',
      signature,
      protocol: 'BIP322',
    },
  };
}

async function signPsbt(origin: string, rawParams: unknown) {
  const params = paramsObject<SignPsbtParams>(rawParams);
  const network = normalizeNetwork(params.network);

  if (typeof params.psbt !== 'string' || !isSignInputs(params.signInputs)) {
    throw new Error('ducat_signPsbt requires psbt and signInputs.');
  }

  const keySet = await getAccountKeySet(network);
  const prepared = preparePsbtForSigning(params.psbt, network, keySet, params.signInputs);

  await confirmPsbt({ origin, summary: prepared.summary, context: params.context });

  const psbt = signPreparedPsbt(prepared.psbt, keySet, params.signInputs);

  await appendRecentAction({
    actionType: params.context?.actionType ?? 'sign-psbt',
    network,
    origin,
    summary: `Signed inputs ${prepared.summary.signedInputIndexes.join(', ')}`,
  });

  return { psbt };
}

function isBatchEntry(value: unknown): value is { psbt: string; signInputs: SignInputs; context?: DucatActionContext } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as { psbt?: unknown; signInputs?: unknown };

  return typeof entry.psbt === 'string' && isSignInputs(entry.signInputs);
}

async function signBatch(origin: string, rawParams: unknown) {
  const params = paramsObject<SignBatchParams>(rawParams);
  const network = normalizeNetwork(params.network);

  if (!Array.isArray(params.entries) || params.entries.length === 0 || !params.entries.every(isBatchEntry)) {
    throw new Error('ducat_signBatch requires a non-empty entries array.');
  }

  const keySet = await getAccountKeySet(network);
  const prepared = params.entries.map((entry) => ({
    ...entry,
    ...preparePsbtForSigning(entry.psbt, network, keySet, entry.signInputs),
  }));

  await confirmBatch({
    origin,
    summaries: prepared.map((item) => item.summary),
    context: params.context,
  });

  const psbts = prepared.map((item) => signPreparedPsbt(item.psbt, keySet, item.signInputs));

  await appendRecentAction({
    actionType: params.context?.actionType ?? 'sign-batch',
    network,
    origin,
    summary: `Signed ${psbts.length} PSBTs`,
  });

  return { psbts };
}

export async function handleRpcRequest(origin: string, request: JsonRpcRequest) {
  assertAllowedOrigin(origin);

  switch (request.method) {
    case 'ducat_getAccounts': {
      const params = paramsObject<{ network?: unknown }>(request.params);
      return (await getAccountKeySet(params.network)).record;
    }

    case 'ducat_signMessage':
      return signMessage(origin, request.params);

    case 'ducat_signPsbt':
      return signPsbt(origin, request.params);

    case 'ducat_signBatch':
      return signBatch(origin, request.params);

    case 'ducat_sendTransfer':
      return sendTransfer(origin, paramsObject(request.params));

    case 'ducat_getHomeState': {
      const params = paramsObject<{ network?: unknown }>(request.params);
      return getHomeState(params.network);
    }

    default:
      throw new Error(`Method not found: ${request.method}`);
  }
}
