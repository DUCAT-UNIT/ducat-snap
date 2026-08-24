/** @fileoverview Authorizes and dispatches bounded RPC requests while gating unprompted signing to development. */
import type { Json } from '@metamask/snaps-sdk';

import { getRoleForAddress } from './accounts';
import { artifactPolicy, assertDeploymentAvailable } from './artifact-policy';
import { confirmBatch, confirmMessage, confirmPsbt } from './confirmations';
import { snapDebug } from './debug';
import { actionLabel } from './display';
import { ducatError } from './errors';
import { getActiveAccountKeySet } from './key-overrides';
import { signBip322SimpleMessage } from './message';
import { assertSelectedNetwork, getSelectedNetwork, requestNetworkSwitch } from './network-selection';
import { bitcoinNetworkForDeployment, normalizeDeploymentId } from './networks';
import { notifyAction, notifyActionFailure } from './notifications';
import { assertUniqueBatchOutpoints, preparePsbtForSigning, signPreparedPsbt } from './psbt';
import { createPsbtVerificationContext } from './psbt-verification';
import { appendRecentAction, rememberDucatSession } from './state';
import type { DeploymentId, DucatActionContext, SignInputs } from './types';
import { getWalletInventory, invalidateWalletInventory } from './wallet-inventory';
import packageJson from '../package.json';

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

type SignMessageResponse = {
  status: 'success';
  result: {
    address: string;
    messageHash: string;
    protocol: 'BIP322';
    signature: string;
  };
};

type SignPsbtResponse = {
  psbt: string;
};

type SignBatchResponse = {
  psbts: string[];
};

type CapabilitiesResponse = {
  snap: string;
  version: string;
  networks: DeploymentId[];
  methods: string[];
  features: {
    batchSigning: boolean;
    bip322MessageSigning: boolean;
    completeExternalRecipientVisibility: boolean;
    explicitNetworkSelection: boolean;
    mainnet: boolean;
    psbtSigning: boolean;
    snapHome: boolean;
    walletInventory: boolean;
  };
};

const MAX_SIGN_INPUTS = 80;
const MAX_BATCH_ENTRIES = 10;
const MAX_MESSAGE_LENGTH = 800;
const MAX_METADATA_ENTRIES = 16;
const MAX_METADATA_KEY_LENGTH = 64;
const MAX_METADATA_VALUE_LENGTH = 200;
const MAX_CONTEXT_LABEL_LENGTH = 200;

const ARTIFACT_POLICY = artifactPolicy();

export const ALLOWED_ORIGINS = new Set<string>(ARTIFACT_POLICY.allowed_origins);

// Build-time gate for the dev-only unprompted signing path. mm-snap/webpack replaces
// `process.env.DUCAT_SNAP_DEV_UNPROMPTED` with a string literal at build time, so when it is
// not 'true' this resolves to a `false` constant and every branch guarded by it (the
// `ducat_signPsbtUnprompted` method handler) is dead-code-eliminated from the bundle. The
// published/audited mainnet build never sets this var: the unprompted path does not exist there.
// Only a separate, unpublished dev build (snap.config injects DUCAT_SNAP_DEV_UNPROMPTED=true)
// enables it, and even then mainnet is hard-refused at the call site.
export const DEV_UNPROMPTED_ENABLED = process.env.DUCAT_SNAP_DEV_UNPROMPTED === 'true';

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

function isOptionalLabel(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= MAX_CONTEXT_LABEL_LENGTH);
}

function isMetadataValue(value: unknown): value is string | number | boolean | null | undefined {
  if (value === undefined || value === null || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  return typeof value === 'string' && value.length <= MAX_METADATA_VALUE_LENGTH;
}

function isMetadataContext(value: unknown): value is NonNullable<DucatActionContext['metadata']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);

  return (
    entries.length <= MAX_METADATA_ENTRIES &&
    entries.every(([key, metadataValue]) => key.length > 0 && key.length <= MAX_METADATA_KEY_LENGTH && isMetadataValue(metadataValue))
  );
}

function isActionContext(value: unknown): value is DucatActionContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const context = value as DucatActionContext;

  return (
    isOptionalLabel(context.actionType) &&
    isOptionalLabel(context.title) &&
    isOptionalLabel(context.flow) &&
    (context.metadata === undefined || isMetadataContext(context.metadata)) &&
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

function paramsObject(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {};
  }

  return Object.fromEntries(Object.entries(params));
}

const FORBIDDEN_PUBLIC_PARAM_KEYS = new Set([
  'accountId',
  'account_id',
  'assetId',
  'asset_id',
  'validatorUrl',
  'validator_url',
  'validatorEndpoint',
  'esploraUrl',
  'esplora_url',
  'esploraEndpoint',
  'privateKey',
  'private_key',
]);

function assertExactParams(rawParams: unknown, allowed: readonly string[]): Record<string, unknown> {
  const params = paramsObject(rawParams);
  const unexpected = Object.keys(params).find((key) => FORBIDDEN_PUBLIC_PARAM_KEYS.has(key) || !allowed.includes(key));
  if (unexpected) {
    throw ducatError('INVALID_PARAMS', 'The Ducat Snap request contains an unsupported parameter.', { field: unexpected });
  }
  return params;
}

async function signMessage(origin: string, rawParams: unknown): Promise<SignMessageResponse> {
  const params = assertExactParams(rawParams, ['network', 'address', 'message', 'context']) as SignMessageParams;

  const network = normalizeDeploymentId(params.network);
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

  const keySet = await getActiveAccountKeySet(network);
  const role = getRoleForAddress(keySet, address);

  if (!role) {
    throw ducatError('UNMANAGED_ADDRESS', 'This address is not managed by the Ducat Snap.', { address });
  }

  await rememberDucatSession(origin);
  const title = actionLabel(context, 'Sign Ducat message');

  await notifyAction({ title, status: 'pending', detail: 'Message signature approval requested' });
  await confirmMessage({ origin, network, address, role, message, context });

  const { signature, messageHash } = signBip322SimpleMessage({
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
      messageHash,
      signature,
      protocol: 'BIP322',
    },
  };
}

// `confirm` controls only whether the human confirmation dialog is shown. Every other
// safety check (origin allowlist, network normalization, input-ownership policy, sighash
// allowlists, cosign-leaf validation) runs identically regardless. The default — and the
// ONLY value reachable in the published build — is `true`. The unprompted path
// (`confirm: false`) is exclusively driven by the dev-only RPC method below, which is
// dead-code-eliminated from production (see DEV_UNPROMPTED_ENABLED).
async function signPsbt(origin: string, rawParams: unknown, confirm = true): Promise<SignPsbtResponse> {
  const params = assertExactParams(rawParams, ['network', 'psbt', 'signInputs', 'context']) as SignPsbtParams;
  const network = normalizeDeploymentId(params.network);

  if (typeof params.psbt !== 'string') {
    throw ducatError('INVALID_PARAMS', 'Ducat transaction signing requires a PSBT.');
  }

  const context = optionalContext(params.context);
  const signInputs = parseSignInputs(params.signInputs, 'signInputs');
  const keySet = await getActiveAccountKeySet(network);
  const prepared = preparePsbtForSigning(params.psbt, network, keySet, signInputs);
  if (prepared.summary.feeSats === null) {
    throw ducatError('PSBT_FEE_UNAVAILABLE', 'This PSBT does not include enough value data to compute the Bitcoin miner fee, so the Ducat Snap cannot show the total you would pay and will not sign it.', {
      inputCount: prepared.summary.inputCount,
      inputValueSats: prepared.summary.inputValueSats,
    });
  }
  const verification = await createPsbtVerificationContext(network);
  await verification.verify(prepared.psbt, prepared.summary);
  const decodedActionType = prepared.summary.vaultUpdates[0]?.actionType;
  const actionContext = decodedActionType ? { ...(context ?? {}), actionType: decodedActionType } : context;
  const title = actionLabel(actionContext, 'Sign Ducat transaction');

  await rememberDucatSession(origin);
  await notifyAction({ title, status: 'pending', detail: 'Transaction approval requested' });

  if (confirm) {
    await confirmPsbt({ origin, summary: prepared.summary, context });
  }

  const psbt = signPreparedPsbt(prepared.psbt, keySet, signInputs);
  // The website may broadcast immediately and then invalidate its shared query.
  // Drop the pre-sign snapshot now so that next read observes the resulting
  // wallet state instead of reusing inputs this signature is expected to spend.
  invalidateWalletInventory(network);

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

function assertSingleNetwork(summaries: { network: DeploymentId }[]): void {
  const firstNetwork = summaries[0]?.network;

  if (firstNetwork && summaries.some((summary) => summary.network !== firstNetwork)) {
    throw ducatError('INVALID_NETWORK', 'All PSBTs in a Ducat batch must use the same network.');
  }
}

function capabilities(): CapabilitiesResponse {
  return {
    snap: '@ducat-unit/wallet-snap',
    version: packageJson.version,
    networks: [...ARTIFACT_POLICY.allowed_deployments],
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
      bip322MessageSigning: true,
      completeExternalRecipientVisibility: true,
      explicitNetworkSelection: true,
      psbtSigning: true,
      batchSigning: true,
      snapHome: true,
      mainnet: ARTIFACT_POLICY.allowed_deployments.includes('mainnet'),
      walletInventory: true,
    },
  };
}

const NETWORK_SCOPED_METHODS = new Set([
  'ducat_getAccounts',
  'ducat_getWalletInventory',
  'ducat_switchNetwork',
  'ducat_signMessage',
  'ducat_signPsbt',
  'ducat_signBatch',
  ...(DEV_UNPROMPTED_ENABLED ? ['ducat_signPsbtUnprompted'] : []),
]);

const SELECTED_DEPLOYMENT_METHODS = new Set([
  'ducat_getAccounts',
  'ducat_getWalletInventory',
  'ducat_signMessage',
  'ducat_signPsbt',
  'ducat_signBatch',
  ...(DEV_UNPROMPTED_ENABLED ? ['ducat_signPsbtUnprompted'] : []),
]);

const REGISTERED_METHODS = new Set([
  'ducat_getCapabilities',
  'ducat_getNetwork',
  'ducat_switchNetwork',
  'ducat_getAccounts',
  'ducat_getWalletInventory',
  'ducat_signMessage',
  'ducat_signPsbt',
  'ducat_signBatch',
  ...(DEV_UNPROMPTED_ENABLED ? ['ducat_signPsbtUnprompted'] : []),
]);

function assertRegisteredMethod(method: string): void {
  if (!REGISTERED_METHODS.has(method)) {
    throw ducatError('METHOD_NOT_FOUND', 'The Ducat Snap does not support this RPC method.', { method });
  }
}

function assertRequestDeploymentAvailable(method: string, paramsInput: unknown): void {
  if (!NETWORK_SCOPED_METHODS.has(method)) {
    return;
  }

  const params = paramsObject(paramsInput);
  assertDeploymentAvailable(normalizeDeploymentId(params.network));
}

async function assertRequestNetwork(method: string, paramsInput: unknown): Promise<void> {
  if (!SELECTED_DEPLOYMENT_METHODS.has(method)) {
    return;
  }

  const params = paramsObject(paramsInput);
  await assertSelectedNetwork(params.network);
}

async function signBatch(origin: string, rawParams: unknown): Promise<SignBatchResponse> {
  const params = assertExactParams(rawParams, ['network', 'entries', 'context']) as SignBatchParams;

  const network = normalizeDeploymentId(params.network);
  const context = optionalContext(params.context);
  const entries = parseBatchEntries(params.entries);
  snapDebug('signBatch: enter', {
    origin,
    network,
    entries: entries.length,
    signInputs: entries.map((e) => e.signInputs),
    actionType: context?.actionType,
  });

  const keySet = await getActiveAccountKeySet(network);
  const prepared = entries.map((entry) => ({
    ...entry,
    ...preparePsbtForSigning(entry.psbt, network, keySet, entry.signInputs),
  }));
  snapDebug('signBatch: psbts prepared', { count: prepared.length });
  assertSingleNetwork(prepared.map((item) => item.summary));
  // Reject a batch whose entries spend the same outpoint: the dialog promises the
  // batch is all-or-nothing, but conflicting transactions can never all confirm (SAY-04).
  assertUniqueBatchOutpoints(prepared.map((item) => item.psbt));
  const unavailableFeeEntry = prepared.findIndex((item) => item.summary.feeSats === null);
  if (unavailableFeeEntry !== -1) {
    throw ducatError('PSBT_FEE_UNAVAILABLE', 'A transaction in this Ducat batch does not include enough value data to compute its Bitcoin miner fee.', {
      entryIndex: unavailableFeeEntry,
    });
  }
  const verification = await createPsbtVerificationContext(network);
  // Verify in signing order so an output created by an earlier unbroadcast
  // entry can be trusted as a later entry's prevout. The shared context still
  // deduplicates genuinely external Esplora reads, and no confirmation occurs
  // until every entry has passed.
  for (const item of prepared) {
    await verification.verify(item.psbt, item.summary);
  }
  const decodedActionType = prepared.find((item) => item.summary.vaultUpdates.length > 0)?.summary.vaultUpdates[0]?.actionType;
  const actionContext = decodedActionType ? { ...(context ?? {}), actionType: decodedActionType } : context;
  const title = actionLabel(actionContext, 'Sign Ducat batch');

  await rememberDucatSession(origin);
  await notifyAction({ title, status: 'pending', detail: `${prepared.length} transaction approval requested` });
  snapDebug('signBatch: requesting confirmation dialog', { title });
  await confirmBatch({
    origin,
    entries: prepared.map((item) => ({ summary: item.summary, context: item.context })),
    context,
  });
  snapDebug('signBatch: confirmation approved; signing');

  const psbts = prepared.map((item) => signPreparedPsbt(item.psbt, keySet, item.signInputs));
  invalidateWalletInventory(network);
  snapDebug('signBatch: signed', { count: psbts.length });

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

async function withFailureNotification<Result>(title: string, action: () => Promise<Result>): Promise<Result> {
  try {
    return await action();
  } catch (error) {
    snapDebug('action FAILED', title, '::', error instanceof Error ? error.message : String(error));
    await notifyActionFailure(title, error);
    throw error;
  }
}

function actionTitleFromParams(rawParams: unknown, fallback: string): string {
  const params = paramsObject(rawParams);

  return actionLabel(optionalContext(params.context), fallback);
}

function assertUnpromptedSigningNetwork(method: string, rawParams: unknown): void {
  if (!DEV_UNPROMPTED_ENABLED || method !== 'ducat_signPsbtUnprompted') return;

  const deploymentId = normalizeDeploymentId(paramsObject(rawParams).network);
  if (bitcoinNetworkForDeployment(deploymentId) === 'mainnet') {
    throw ducatError(
      'DEPLOYMENT_NOT_AVAILABLE',
      `Unprompted signing is not available for Bitcoin mainnet mechanics (${deploymentId}).`,
      { artifactPolicy: ARTIFACT_POLICY.policy, deploymentId },
    );
  }
}

/**
 * Authorizes the caller and dispatches one bounded Ducat JSON-RPC request fail-closed.
 * @param origin - Requesting origin supplied by the Snap runtime.
 * @param request - Untrusted method and params payload.
 * @returns JSON-compatible result from the selected validated handler.
 * @throws A structured Snap error for disallowed origins, invalid params, or unsupported methods.
 */
export async function handleRpcRequest(origin: string, request: JsonRpcRequest): Promise<Json> {
  snapDebug('rpc <-', request.method, 'from', origin);
  assertAllowedOrigin(origin);
  assertRegisteredMethod(request.method);
  assertRequestDeploymentAvailable(request.method, request.params);
  assertUnpromptedSigningNetwork(request.method, request.params);
  await assertRequestNetwork(request.method, request.params);

  if (DEV_UNPROMPTED_ENABLED && request.method === 'ducat_signPsbtUnprompted') {
    return withFailureNotification(actionTitleFromParams(request.params, 'Sign Ducat transaction (unprompted)'), async () =>
      signPsbt(origin, request.params, false),
    );
  }

  switch (request.method) {
    case 'ducat_getAccounts': {
      const params = assertExactParams(request.params, ['network']);
      const network = normalizeDeploymentId(params.network);
      const account = await getActiveAccountKeySet(network);
      await rememberDucatSession(origin);

      return account.record;
    }

    case 'ducat_getCapabilities':
      assertExactParams(request.params, []);
      return capabilities();

    case 'ducat_getNetwork':
      assertExactParams(request.params, []);
      return getSelectedNetwork();

    case 'ducat_switchNetwork':
      return requestNetworkSwitch(request.params, origin);

    case 'ducat_signMessage':
      return withFailureNotification(actionTitleFromParams(request.params, 'Sign Ducat message'), async () => signMessage(origin, request.params));

    case 'ducat_signPsbt':
      return withFailureNotification(actionTitleFromParams(request.params, 'Sign Ducat transaction'), async () => signPsbt(origin, request.params));

    // Dev/test only: sign WITHOUT the confirmation dialog, for programmatic consumers
    // (e.g. the protocol SDK / e2e harnesses). Triple-gated:
    //   1. DEV_UNPROMPTED_ENABLED is a build-time `false` in the published build, so this
    //      whole branch is dead-code-eliminated — the method does not exist in production.
    //   2. Even if reached, a disabled build reports it as an unknown method (no information leak).
    //   3. The call-site guard normalizes deployment aliases, maps Bitcoin mechanics, and
    //      refuses mainnet-backed deployments before state, key, dialog, or signing effects.
    // All other safety checks (origin allowlist, input-ownership policy, sighash allowlists,
    // cosign-leaf validation) still run — only the human confirmation is skipped.
    case 'ducat_signBatch':
      return withFailureNotification(actionTitleFromParams(request.params, 'Sign Ducat batch'), async () => signBatch(origin, request.params));

    case 'ducat_getWalletInventory': {
      const params = assertExactParams(request.params, ['network']);
      await rememberDucatSession(origin);
      return getWalletInventory(params.network);
    }

    default:
      throw ducatError('METHOD_NOT_FOUND', 'The Ducat Snap does not support this RPC method.', { method: request.method });
  }
}
