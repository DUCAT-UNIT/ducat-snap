import { getAccountKeySet, getRoleForAddress } from './accounts';
import { confirmBatch, confirmClearRecentActions, confirmMessage, confirmPsbt } from './confirmations';
import { actionLabel } from './display';
import { ducatError } from './errors';
import { getHomeState } from './home';
import { signBip322SimpleMessage } from './message';
import { DUCAT_ALLOWED_ORIGINS, normalizeNetwork } from './networks';
import { notifyAction, notifyActionFailure } from './notifications';
import { preparePsbtForSigning, signPreparedPsbt } from './psbt';
import { appendRecentAction, clearRecentActions, rememberDucatSession } from './state';
import { sendTransfer } from './transfer';
import type { DucatActionContext, DucatNetwork, SignInputs } from './types';

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
  context?: unknown;
};

type SignMessageParams = {
  network?: unknown;
  address?: unknown;
  message?: unknown;
  context?: unknown;
};

const MAX_SIGN_INPUTS = 80;
const MAX_BATCH_ENTRIES = 10;
const MAX_MESSAGE_LENGTH = 800;

export const ALLOWED_ORIGINS = new Set<string>(DUCAT_ALLOWED_ORIGINS);

function assertAllowedOrigin(origin: string): void {
  if (!ALLOWED_ORIGINS.has(origin)) {
    throw ducatError('ORIGIN_NOT_AUTHORIZED', 'This site is not authorized to use the Ducat Snap.', { origin });
  }
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isVaultContext(value: unknown): value is NonNullable<DucatActionContext['vault']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const vault = value as NonNullable<DucatActionContext['vault']>;

  return (
    (vault.effect === undefined || typeof vault.effect === 'string') &&
    (vault.source === undefined || typeof vault.source === 'string') &&
    isOptionalNumber(vault.amountSats) &&
    isOptionalNumber(vault.amountUnit) &&
    isOptionalNumber(vault.collateralBeforeSats) &&
    isOptionalNumber(vault.collateralAfterSats) &&
    isOptionalNumber(vault.debtBeforeUnit) &&
    isOptionalNumber(vault.debtAfterUnit) &&
    isOptionalNumber(vault.healthBefore) &&
    isOptionalNumber(vault.healthAfter) &&
    isOptionalNumber(vault.liquidationPrice) &&
    isOptionalNumber(vault.price)
  );
}

function isActionContext(value: unknown): value is DucatActionContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const context = value as DucatActionContext;

  return (
    (context.actionType === undefined || typeof context.actionType === 'string') &&
    (context.title === undefined || typeof context.title === 'string') &&
    (context.flow === undefined || typeof context.flow === 'string') &&
    (context.metadata === undefined || (typeof context.metadata === 'object' && context.metadata !== null && !Array.isArray(context.metadata))) &&
    (context.vault === undefined || isVaultContext(context.vault))
  );
}

function optionalContext(value: unknown): DucatActionContext | undefined {
  return isActionContext(value) ? value : undefined;
}

function parseSignInputs(value: unknown, label: string): SignInputs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ducatError('INVALID_PARAMS', `${label} must be an object keyed by Ducat account address.`);
  }

  const entries = Object.entries(value);
  const seenIndexes = new Set<number>();
  let inputCount = 0;
  const parsed: SignInputs = {};

  if (!entries.length) {
    throw ducatError('INVALID_PARAMS', `${label} must include at least one input to sign.`);
  }

  for (const [address, indexes] of entries) {
    if (!address || !Array.isArray(indexes) || indexes.length === 0) {
      throw ducatError('INVALID_PARAMS', `${label} must include a non-empty input index array for each address.`, { address });
    }

    parsed[address] = indexes.map((index) => {
      if (!Number.isSafeInteger(index) || index < 0) {
        throw ducatError('INVALID_PARAMS', `${label} contains an invalid PSBT input index.`, { address, index });
      }

      if (seenIndexes.has(index)) {
        throw ducatError('INVALID_PARAMS', `${label} contains a duplicate PSBT input index.`, { inputIndex: index });
      }

      seenIndexes.add(index);
      inputCount += 1;

      if (inputCount > MAX_SIGN_INPUTS) {
        throw ducatError('INVALID_PARAMS', `${label} requests too many input signatures for one Snap request.`, { maxSignInputs: MAX_SIGN_INPUTS });
      }

      return index;
    });
  }

  return parsed;
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
  const context = optionalContext(params.context);

  if (!address || !message) {
    throw ducatError('INVALID_PARAMS', 'Ducat message signing requires an address and message.');
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw ducatError('INVALID_PARAMS', 'Ducat message signing requests must fit fully in the MetaMask confirmation.', {
      maxMessageLength: MAX_MESSAGE_LENGTH,
      actualMessageLength: message.length,
    });
  }

  const keySet = await getAccountKeySet(network);
  const role = getRoleForAddress(keySet, address);

  if (!role) {
    throw ducatError('UNMANAGED_ADDRESS', 'This address is not managed by the Ducat Snap.', { address });
  }

  await rememberDucatSession(network, origin);
  const title = actionLabel(context, 'Sign Ducat message');

  await notifyAction({ title, status: 'pending', detail: 'Message signature approval requested' });
  await confirmMessage({ origin, network, address, role, message, context });

  const signature = signBip322SimpleMessage({
    keySet,
    role,
    message,
  });

  await appendRecentAction({
    actionType: context?.actionType ?? 'sign-message',
    title,
    network,
    origin,
    status: 'signed',
    summary: `Signed message for ${address}`,
  });
  await notifyAction({ title, status: 'completed', detail: 'Message signed' });

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

  if (typeof params.psbt !== 'string') {
    throw ducatError('INVALID_PARAMS', 'Ducat transaction signing requires a PSBT.');
  }

  const context = optionalContext(params.context);
  const signInputs = parseSignInputs(params.signInputs, 'signInputs');
  const keySet = await getAccountKeySet(network);
  const prepared = preparePsbtForSigning(params.psbt, network, keySet, signInputs);
  const decodedActionType = prepared.summary.vaultUpdates[0]?.actionType;
  const actionContext = decodedActionType ? { ...(context ?? {}), actionType: decodedActionType } : context;
  const title = actionLabel(actionContext, 'Sign Ducat transaction');

  await rememberDucatSession(network, origin);
  await notifyAction({ title, status: 'pending', detail: 'Transaction approval requested' });
  await confirmPsbt({ origin, summary: prepared.summary, context });

  const psbt = signPreparedPsbt(prepared.psbt, keySet, signInputs);

  await appendRecentAction({
    actionType: decodedActionType ?? context?.actionType ?? 'sign-psbt',
    title,
    network,
    origin,
    status: 'signed',
    amountSats: prepared.summary.externalOutputSats || undefined,
    summary: `Signed inputs ${prepared.summary.signedInputIndexes.join(', ')}`,
  });
  await notifyAction({ title, status: 'completed', detail: `Signed inputs ${prepared.summary.signedInputIndexes.join(', ')}` });

  return { psbt };
}

type ParsedBatchEntry = { psbt: string; signInputs: SignInputs; context?: DucatActionContext };

function parseBatchEntries(value: unknown): ParsedBatchEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw ducatError('BATCH_ENTRY_INVALID', 'Ducat batch signing requires a non-empty entries array.');
  }

  if (value.length > MAX_BATCH_ENTRIES) {
    throw ducatError('BATCH_ENTRY_INVALID', 'Ducat batch signing has too many transactions for one confirmation.', {
      maxBatchEntries: MAX_BATCH_ENTRIES,
      actualBatchEntries: value.length,
    });
  }

  return value.map((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw ducatError('BATCH_ENTRY_INVALID', 'Every Ducat batch entry must be an object.', { entryIndex: index });
    }

    const entry = rawEntry as { psbt?: unknown; signInputs?: unknown; context?: unknown };

    if (typeof entry.psbt !== 'string') {
      throw ducatError('BATCH_ENTRY_INVALID', 'Every Ducat batch entry requires a PSBT.', { entryIndex: index });
    }

    return {
      psbt: entry.psbt,
      signInputs: parseSignInputs(entry.signInputs, `entries[${index}].signInputs`),
      context: optionalContext(entry.context),
    };
  });
}

function assertSingleNetwork(summaries: { network: DucatNetwork }[]): void {
  const firstNetwork = summaries[0]?.network;

  if (firstNetwork && summaries.some((summary) => summary.network !== firstNetwork)) {
    throw ducatError('INVALID_NETWORK', 'All PSBTs in a Ducat batch must use the same network.');
  }
}

function capabilities() {
  return {
    snap: '@ducat-unit/ducat-snap',
    version: '0.1.0',
    networks: ['signet', 'mutinynet'],
    methods: [
      'ducat_clearRecentActions',
      'ducat_getAccounts',
      'ducat_getCapabilities',
      'ducat_getHomeState',
      'ducat_signMessage',
      'ducat_signPsbt',
      'ducat_signBatch',
      'ducat_sendTransfer',
    ],
    features: {
      bip322MessageSigning: true,
      psbtSigning: true,
      batchSigning: true,
      simpleBtcTransfer: true,
      snapHome: true,
      mainnet: false,
    },
  };
}

async function signBatch(origin: string, rawParams: unknown) {
  const params = paramsObject<SignBatchParams>(rawParams);
  const network = normalizeNetwork(params.network);
  const context = optionalContext(params.context);
  const entries = parseBatchEntries(params.entries);

  const keySet = await getAccountKeySet(network);
  const prepared = entries.map((entry) => ({
    ...entry,
    ...preparePsbtForSigning(entry.psbt, network, keySet, entry.signInputs),
  }));
  assertSingleNetwork(prepared.map((item) => item.summary));
  const decodedActionType = prepared.find((item) => item.summary.vaultUpdates.length > 0)?.summary.vaultUpdates[0]?.actionType;
  const actionContext = decodedActionType ? { ...(context ?? {}), actionType: decodedActionType } : context;
  const title = actionLabel(actionContext, 'Sign Ducat batch');

  await rememberDucatSession(network, origin);
  await notifyAction({ title, status: 'pending', detail: `${prepared.length} transaction approval requested` });
  await confirmBatch({
    origin,
    entries: prepared.map((item) => ({ summary: item.summary, context: item.context })),
    context,
  });

  const psbts = prepared.map((item) => signPreparedPsbt(item.psbt, keySet, item.signInputs));

  await appendRecentAction({
    actionType: decodedActionType ?? context?.actionType ?? 'sign-batch',
    title,
    network,
    origin,
    status: 'signed',
    summary: `Signed ${psbts.length} PSBTs`,
  });
  await notifyAction({ title, status: 'completed', detail: `Signed ${psbts.length} PSBTs` });

  return { psbts };
}

async function withFailureNotification<T>(title: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    await notifyActionFailure(title, error);
    throw error;
  }
}

function actionTitleFromParams(rawParams: unknown, fallback: string): string {
  const params = paramsObject<{ context?: unknown }>(rawParams);

  return actionLabel(optionalContext(params.context), fallback);
}

export async function handleRpcRequest(origin: string, request: JsonRpcRequest) {
  assertAllowedOrigin(origin);

  switch (request.method) {
    case 'ducat_clearRecentActions':
      await confirmClearRecentActions(origin);
      await clearRecentActions();

      return { cleared: true };

    case 'ducat_getAccounts': {
      const params = paramsObject<{ network?: unknown }>(request.params);
      const network = normalizeNetwork(params.network);
      const account = await getAccountKeySet(network);
      await rememberDucatSession(network, origin);

      return account.record;
    }

    case 'ducat_getCapabilities':
      return capabilities();

    case 'ducat_signMessage':
      return withFailureNotification(actionTitleFromParams(request.params, 'Sign Ducat message'), () => signMessage(origin, request.params));

    case 'ducat_signPsbt':
      return withFailureNotification(actionTitleFromParams(request.params, 'Sign Ducat transaction'), () => signPsbt(origin, request.params));

    case 'ducat_signBatch':
      return withFailureNotification(actionTitleFromParams(request.params, 'Sign Ducat batch'), () => signBatch(origin, request.params));

    case 'ducat_sendTransfer':
      return withFailureNotification('Send BTC', () => sendTransfer(origin, paramsObject(request.params)));

    case 'ducat_getHomeState': {
      const params = paramsObject<{ network?: unknown }>(request.params);
      return getHomeState(params.network);
    }

    default:
      throw ducatError('METHOD_NOT_FOUND', 'The Ducat Snap does not support this RPC method.', { method: request.method });
  }
}
