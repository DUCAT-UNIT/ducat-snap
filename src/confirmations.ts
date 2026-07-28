/** @fileoverview Builds fail-closed confirmations from verified facts while separating untrusted app metadata. */
import { crypto } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { DUCAT_MARK_SVG } from './brand';
import {
  actionLabel,
  formatBtcValue,
  formatInteger,
  formatMetadataKey,
  formatMaybeBtcValue,
  formatSats,
  formatSatsOnly,
  formatUnit,
  networkLabel,
  originNameLabel,
  originUrlLabel,
  roleLabel,
  sanitizeMarkdown,
  truncateMiddle,
  unverifiedActionLabel,
} from './display';
import { ducatError } from './errors';
import { VISIBLE_OUTPUT_FOLD } from './psbt';
import type {
  DucatActionContext,
  DucatAddressRole,
  DucatNetwork,
  DucatVaultReturnData,
  PsbtOutputSummary,
  PsbtSummary,
} from './types';
import {
  uiBanner,
  uiBox,
  uiCard,
  uiCollapsibleSection,
  uiCopyable,
  uiDivider,
  uiHeading,
  uiIcon,
  uiInline,
  uiMuted,
  uiRow,
  uiSection,
  uiText,
  uiValue,
  type SnapElement,
} from './ui';

function detailValue(primary: string, secondary?: string): SnapElement {
  return secondary ? uiValue(primary, secondary) : uiText(primary, { alignment: 'end', fontWeight: 'medium' });
}

function compactCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function maybeAddSats(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function sumNullable(values: (number | null)[]): number | null {
  return values.reduce<number | null>((total, value) => {
    if (total === null || value === null) {
      return null;
    }

    return total + value;
  }, 0);
}

function signedInputTitle(role: DucatAddressRole): string {
  if (role === 'sats') {
    return 'BTC account';
  }

  return role === 'runes' ? 'UNIT account' : 'Vault multisig';
}

function outputDetailLabel(output: PsbtOutputSummary): string {
  if (output.vaultData) {
    return 'Ducat vault data';
  }

  if (isDataOutput(output)) {
    return 'Transaction data';
  }

  if (output.role === 'op_return') {
    return 'OP_RETURN data output';
  }

  if (output.role === 'unknown') {
    return 'Unknown script output';
  }

  if (output.role === 'sats' || output.role === 'runes' || output.role === 'vault') {
    return output.isMine ? `${roleLabel(output.role)} change` : 'External recipient';
  }

  return 'External recipient';
}

function isDataOutput(output: PsbtOutputSummary): boolean {
  return output.role === 'op_return' || (output.role === 'unknown' && output.valueSats === 0);
}

function compactReviewLine(
  label: string,
  sats: number | null,
  description: string,
  variant?: 'default' | 'warning' | 'critical',
): SnapElement {
  return uiRow(label, detailValue(formatMaybeBtcValue(sats), sats === null ? description : `${formatSatsOnly(sats)} - ${description}`), variant);
}

function amountCard(title: string, sats: number | null, description: string, emptyExtra = 'review details'): SnapElement {
  return uiCard({
    description,
    extra: sats === null ? emptyExtra : formatSatsOnly(sats),
    title,
    value: formatMaybeBtcValue(sats),
  });
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatMaybeUnitValue(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatUnit(value) : 'Unavailable';
}

function formatMaybeBtcVaultValue(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatBtcValue(value) : 'Unavailable';
}

function formatMaybeHealth(value: number | null | undefined): string {
  if (value === null) {
    return 'No UNIT debt';
  }

  return isFiniteNumber(value) ? `${formatInteger(value)}%` : 'Unavailable';
}

function formatMaybeUsd(value: number | null | undefined): string {
  return isFiniteNumber(value)
    ? `$${value.toLocaleString('en-US', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })}`
    : 'Unavailable';
}

function vaultEffect(actionType: string): string {
  switch (actionKey({ actionType })) {
    case 'borrow':
      return 'Increases UNIT debt against the vault.';
    case 'create':
      return 'Creates or opens a Ducat vault.';
    case 'deposit':
      return 'Adds BTC collateral to the vault.';
    case 'liquidate':
    case 'liquidation':
      return 'Signs a liquidation for an under-collateralized vault.';
    case 'repay':
      return 'Reduces UNIT debt on the vault.';
    case 'repo':
    case 'repossess':
      return 'Repossesses collateral through the liquidation flow.';
    case 'withdraw':
      return 'Removes BTC collateral from the vault.';
    default:
      return 'Updates a Ducat vault.';
  }
}

function vaultHealthFromReturnData(vaultData: DucatVaultReturnData): number | null | undefined {
  if (vaultData.unitBalanceUnit === 0) {
    return null;
  }

  if (!vaultData.collateralSats || !vaultData.unitPrice) {
    return undefined;
  }

  const collateralBtc = vaultData.collateralSats / 100_000_000;

  return Math.round(((collateralBtc * vaultData.unitPrice) / vaultData.unitBalanceUnit) * 100);
}

function contextFromDecodedVault(summary: PsbtSummary, context?: DucatActionContext): DucatActionContext {
  const vaultData = summary.vaultUpdates[0];

  if (!vaultData) {
    // No Ducat vault data is decodable from the PSBT. We cannot vouch for any vault numbers the
    // app supplied, so we drop the entire context.vault block rather than render unverified
    // collateral/debt/health/liquidation figures as if they were facts.
    if (!context) {
      return {};
    }

    const contextWithoutVault: DucatActionContext = { ...context };

    delete contextWithoutVault.vault;

    return contextWithoutVault;
  }

  const healthAfter = vaultHealthFromReturnData(vaultData);

  // Every numeric field below is taken strictly from the PSBT-decoded vault data. App-supplied
  // vault numbers are never used as a fallback, and `source` is always stamped by us so the
  // "decoded from vault data" provenance cannot be forged via context. `collateralSats` is the
  // one figure not carried in the OP_RETURN payload — it is read from the vault output's value,
  // but only after inferVaultCollateralSats() confirms that output actually pays the user's own
  // vault address (SAY-01); a non-vault output yields `undefined`, not an attacker-chosen amount.
  return {
    ...context,
    actionType: vaultData.actionType,
    title: actionLabel({ actionType: vaultData.actionType }, 'Ducat vault update'),
    vault: {
      collateralAfterSats: vaultData.collateralSats,
      debtAfterUnit: vaultData.unitBalanceUnit,
      effect: vaultEffect(vaultData.actionType),
      healthAfter: healthAfter === undefined ? undefined : healthAfter,
      liquidationPrice: vaultData.isLocked ? vaultData.tholdPrice : undefined,
      price: vaultData.unitPrice,
      source: 'op_return',
    },
  };
}

function vaultAmountText(context?: DucatActionContext): string | undefined {
  const amountSats = context?.vault?.amountSats;
  const amountUnit = context?.vault?.amountUnit;
  const parts = [
    isFiniteNumber(amountSats) ? formatBtcValue(amountSats) : undefined,
    isFiniteNumber(amountUnit) ? formatUnit(amountUnit) : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(' + ') : undefined;
}

function vaultActionSection(context?: DucatActionContext): SnapElement[] {
  const vault = context?.vault;

  if (!vault) {
    return [];
  }

  const amount = vaultAmountText(context);
  const rows: SnapElement[] = [];

  if (vault.collateralAfterSats !== undefined) {
    rows.push(uiRow('Collateral', detailValue(formatMaybeBtcVaultValue(vault.collateralAfterSats))));
  }

  if (vault.debtAfterUnit !== undefined) {
    rows.push(uiRow('UNIT debt', detailValue(formatMaybeUnitValue(vault.debtAfterUnit))));
  }

  if (vault.healthAfter !== undefined) {
    rows.push(uiRow('Health factor', detailValue(formatMaybeHealth(vault.healthAfter))));
  }

  if (vault.liquidationPrice !== undefined) {
    rows.push(uiRow('Liquidation threshold', detailValue(formatMaybeUsd(vault.liquidationPrice))));
  }

  return [
    uiSection([
      uiHeading('Vault update'),
      uiCard({
        description: vault.effect ?? actionIntent(context),
        extra: vault.source === 'op_return' ? 'decoded from vault data' : undefined,
        title: actionLabel(context, 'Vault transaction'),
        value: amount ?? 'Review request',
      }),
    ]),
    ...(rows.length
      ? [
          uiSection([
            uiHeading('Updated vault state'),
            ...rows,
          ]),
        ]
      : []),
  ];
}

function countCard(title: string, value: string, description: string, extra?: string): SnapElement {
  return uiCard({
    description,
    extra,
    title,
    value,
  });
}

function unitEvidenceRows(summary: PsbtSummary): SnapElement[] {
  return summary.unitInputs.map((input) =>
    uiRow(
      truncateMiddle(input.coinId, 12, 8),
      detailValue(
        `${input.activeAmount} active / ${input.reservedAmount} reserved`,
        `${input.classification} - asset ${input.assetId}`,
      ),
    ),
  );
}

function actionKey(context?: DucatActionContext): string | null {
  const raw = context?.actionType ?? context?.flow ?? context?.title;

  return raw ? raw.trim().toLowerCase().replace(/_/gu, '-').replace(/ /gu, '-') : null;
}

function actionIntent(context?: DucatActionContext): string {
  switch (actionKey(context)) {
    case 'borrow':
      return 'Check vault inputs, UNIT settlement, and fee.';
    case 'create':
      return 'Check vault funding outputs and change.';
    case 'deposit':
      return 'Check collateral, change, and fee.';
    case 'liquidate':
    case 'liquidation':
    case 'liquidation-or-repossess':
    case 'repo':
    case 'repossess':
      return 'Check every spend and output carefully.';
    case 'repay':
      return 'Check UNIT repayment, vault inputs, and fee.';
    case 'swap':
      return 'Check recipient value, change, and fee.';
    case 'withdraw':
      return 'Check destination, returned change, and fee.';
    default:
      return 'Check parsed Bitcoin amounts before signing.';
  }
}

/**
 * Build a short safety indicator for confirmation summaries.
 * @param message - Safety copy displayed next to the icon.
 * @param variant - Visual state for the indicator.
 * @returns The rendered safety indicator.
 */
function inlineSecurity(message: string, variant: 'success' | 'warning'): SnapElement {
  return uiInline([
    uiIcon(variant === 'success' ? 'security-tick' : 'warning', variant),
    uiText(message, { color: variant, fontWeight: 'medium' }),
  ]);
}

function contextSection(context?: DucatActionContext, note = 'App labels are shown for context. Parsed PSBT values above are what the Snap signs.'): SnapElement[] {
  const metadata = Object.entries(context?.metadata ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (!metadata.length) {
    return [];
  }

  return [
    uiCollapsibleSection('Ducat app context', [
      uiMuted(note),
      ...metadata.slice(0, 8).map(([key, value]) => uiRow(formatMetadataKey(key), sanitizeMarkdown(String(value).slice(0, 140)))),
    ]),
  ];
}

function vaultDataDetail(vaultData: DucatVaultReturnData): string {
  const parts = [`${formatUnit(vaultData.unitBalanceUnit)} debt`];

  if (vaultData.collateralSats !== undefined) {
    parts.push(`${formatBtcValue(vaultData.collateralSats)} collateral`);
  }

  if (vaultData.tholdPrice !== undefined) {
    parts.push(`${formatMaybeUsd(vaultData.tholdPrice)} threshold`);
  }

  return `${actionLabel({ actionType: vaultData.actionType })} - ${parts.join(', ')}`;
}

function batchEntryRecipientRows(summary: PsbtSummary): SnapElement[] {
  const externalOutputs = summary.outputs.filter((output) => !output.isMine && !isDataOutput(output));

  if (!externalOutputs.length) {
    return [uiMuted('Self-transfer only - no external recipient.')];
  }

  // Itemize every external recipient. assertAllExternalRecipientsVisible (psbt.ts) already
  // rejects any entry whose external recipients exceed the visible fold, so this list is bounded
  // and never collapses a destination the user is signing over into a "+N more" aggregate (the
  // SAY-07 issue applied equally to this batch-entry view, not just the single-PSBT dialog).
  return externalOutputs.map((output) =>
    uiRow(
      'To',
      detailValue(formatBtcValue(output.valueSats), truncateMiddle(output.address, 12, 8)),
      output.role === 'unknown' ? 'warning' : undefined,
    ),
  );
}

function cosignInputsSection(cosignInputs: PsbtSummary['signedInputs']): SnapElement[] {
  if (!cosignInputs.length) {
    return [];
  }

  const guardKeys = [...new Set(cosignInputs.map((input) => input.cosignGuardPubkey).filter((key): key is string => !!key))];
  const allGuardiansKnown = cosignInputs.every((input) => input.cosignGuardianKnown === true);
  const rows: SnapElement[] = [
    uiMuted('This vault spend uses a Ducat cosign (2-of-2) script path. Confirm the cosigner before approving.'),
  ];

  if (guardKeys.length) {
    for (const guardKey of guardKeys.slice(0, 3)) {
      rows.push(uiRow('Cosigner key', uiCopyable(guardKey)));
    }

    if (guardKeys.length > 3) {
      rows.push(uiMuted(`+ ${guardKeys.length - 3} more cosigner keys`));
    }
  } else {
    rows.push(uiMuted('Cosigner key could not be parsed from the cosign leaf.'));
  }

  rows.push(
    allGuardiansKnown
      ? uiRow('Cosigner', inlineSecurity('Approved Ducat guardian', 'success'))
      : uiRow('Cosigner', inlineSecurity('Not verified as a Ducat guardian', 'warning'), 'warning'),
  );

  return [uiCollapsibleSection(`Vault cosigner (${cosignInputs.length})`, rows, !allGuardiansKnown)];
}

/**
 * The confirmation section for BitVM3 unilateral-exit timeout (reclaim) inputs.
 * Unlike a cosign spend, this is a SINGLE-sig reclaim guarded by a relative
 * timelock — there is no guardian. The note makes that explicit so the user
 * understands they are reclaiming a bonded assert output on their own.
 */
function timeoutInputsSection(timeoutInputs: PsbtSummary['signedInputs']): SnapElement[] {
  if (!timeoutInputs.length) {
    return [];
  }

  const rows: SnapElement[] = [
    uiMuted(
      'This is a BitVM3 unilateral-exit reclaim: you are spending a bonded assert output via its timeout (OP_CSV) leaf. No guardian co-signs — the spend is only valid after the challenge window has passed.',
    ),
    uiRow('Spend path', inlineSecurity('Unilateral timeout reclaim', 'success')),
  ];

  return [uiCollapsibleSection(`Unilateral exit (${timeoutInputs.length})`, rows, false)];
}

/**
 * Requires approval after displaying the exact message, signer role, origin, network, and digest.
 * @param params - Message, digest, role, network, origin, and account metadata.
 * @returns Only after explicit user approval.
 * @throws A user-rejected error when approval is denied.
 */
export async function confirmMessage(params: {
  origin: string;
  network: DucatNetwork;
  address: string;
  role: DucatAddressRole;
  message: string;
  context?: DucatActionContext;
}): Promise<void> {
  // signMessage rejects any message longer than MAX_MESSAGE_LENGTH (800) before this
  // dialog runs, so the whole message always fits and is shown in full (SAY-09: the
  // former truncation/"showing the first 800 characters" branch was unreachable).
  const messageSha256 = crypto.sha256(Buffer.from(params.message)).toString('hex');
  const messageFingerprint = `${messageSha256.slice(0, 16)}...${messageSha256.slice(-8)}`;

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiCard({
          description: `${originNameLabel(params.origin)} - ${networkLabel(params.network)}`,
          extra: roleLabel(params.role),
          image: DUCAT_MARK_SVG,
          title: actionLabel(params.context, 'Message signing'),
          value: 'BIP322',
        }),
        uiBanner('Message signature', 'info', 'This signs a message only. It does not sign a Bitcoin transaction or broadcast funds.'),
        uiSection([
          uiHeading('Message review'),
          uiCard({
            description: truncateMiddle(params.address),
            title: 'Signing account',
            value: roleLabel(params.role),
          }),
          uiCard({
            description: 'SHA256 of the exact message',
            extra: `${params.message.length} characters`,
            title: 'Message fingerprint',
            value: messageFingerprint,
          }),
        ]),
        uiCollapsibleSection('Request details', [
          uiRow('App', detailValue(originNameLabel(params.origin), originUrlLabel(params.origin))),
          uiRow('Network', networkLabel(params.network)),
          uiRow('Signature type', 'BIP322 simple'),
          uiRow('Private keys', 'Stay inside MetaMask'),
        ]),
        uiCollapsibleSection(
          'Message to sign',
          [uiMuted('Copyable value is exactly what will be signed.'), uiCopyable(params.message)],
          true,
        ),
        ...contextSection(params.context, 'App labels are shown for context. The copyable message above is exactly what the Snap signs.'),
        uiDivider(),
        uiMuted('Approve only if this message matches the Ducat app request.'),
      ]),
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected Ducat message signing.');
  }
}

/**
 * Requires approval of a verified PSBT summary including recipients, change, fees, and provenance.
 * @param params - Prepared transaction summary and request context.
 * @returns Only after explicit user approval.
 * @throws When fee visibility is unavailable or approval is denied.
 */
export async function confirmPsbt(params: {
  origin: string;
  summary: PsbtSummary;
  context?: DucatActionContext;
}): Promise<void> {
  const { summary, context, origin } = params;

  const displayContext = contextFromDecodedVault(summary, context);
  const signedInputs = summary.signedInputIndexes.map((index) => `#${index}`).join(', ');
  // When the PSBT carries decodable Ducat vault data, contextFromDecodedVault stamps a
  // Snap-verified actionType and the headline is trustworthy. Otherwise the action name is
  // whatever the app claimed, so tag it "(app-provided)" rather than presenting an unverified
  // string as the authoritative action (SAY-02).
  const isVaultVerified = summary.vaultUpdates.length > 0;
  const action = isVaultVerified ? actionLabel(displayContext, 'Ducat transaction') : unverifiedActionLabel(displayContext, 'Bitcoin transaction');
  const leavesWalletSats = maybeAddSats(summary.externalOutputSats, summary.feeSats);
  const visibleWarnings = summary.warnings.map((warning) => warning.trim()).filter(Boolean);
  const recipientOutputs = summary.outputs
    .map((output, index) => ({ index, output }))
    .filter(({ output }) => !isDataOutput(output));
  const externalOutputCount = recipientOutputs.filter(({ output }) => !output.isMine).length;
  const changeOutputCount = recipientOutputs.filter(({ output }) => output.isMine).length;
  const externalOutputs = recipientOutputs.filter(({ output }) => !output.isMine);
  const primaryExternalOutput = externalOutputs[0]?.output;
  const visibleOutputs = recipientOutputs.slice(0, VISIBLE_OUTPUT_FOLD);
  const hiddenOutputs = recipientOutputs.slice(visibleOutputs.length);
  const hiddenExternalSats = hiddenOutputs.filter(({ output }) => !output.isMine).reduce((total, { output }) => total + output.valueSats, 0);
  const dataOutputs = summary.outputs.map((output, index) => ({ index, output })).filter(({ output }) => isDataOutput(output));
  const reviewDataOutputs = dataOutputs.filter(({ output }) => !output.vaultData);
  const visibleDataOutputs = reviewDataOutputs.slice(0, 4);
  const visibleSignedInputs = [...summary.signedInputs].sort((left, right) => left.index - right.index).slice(0, 6);
  const inputRoleLabel = [...new Set(summary.signedInputs.map((input) => signedInputTitle(input.role)))].join(' + ') || 'No Ducat account inputs';
  const recipientTitle = externalOutputCount === 1 ? 'Recipient' : 'Recipients';
  const recipientDescription =
    externalOutputCount === 1 && primaryExternalOutput
      ? `${outputDetailLabel(primaryExternalOutput)} - ${truncateMiddle(primaryExternalOutput.address, 12, 8)}`
      : compactCount(externalOutputCount, 'external output');
  const statusTitle = visibleWarnings.length ? 'Review before signing' : 'Verified by Ducat Snap';
  const statusSeverity = visibleWarnings.length ? 'warning' : 'success';
  const statusBody = visibleWarnings.length
    ? visibleWarnings[0]
    : `${compactCount(summary.signedInputIndexes.length, 'Ducat input')} matched your Snap-managed account. Private keys stay inside MetaMask.`;
  const inputRows =
    visibleSignedInputs.length > 0
      ? visibleSignedInputs.map((input) =>
          uiRow(
            `Input #${input.index}`,
            detailValue(formatMaybeBtcValue(input.valueSats), `${signedInputTitle(input.role)} - ${truncateMiddle(input.address, 10, 8)}`),
          ),
        )
      : [uiMuted('No inputs requested for signing.')];
  const cosignInputs = summary.signedInputs.filter((input) => input.verification === 'committed-ducat-cosign-leaf');
  const cosignSection = cosignInputsSection(cosignInputs);
  const timeoutInputs = summary.signedInputs.filter((input) => input.verification === 'committed-bitvm3-timeout-leaf');
  const timeoutSection = timeoutInputsSection(timeoutInputs);
  let recipientNumber = 0;
  let changeNumber = 0;
  const outputRows =
    visibleOutputs.length > 0
      ? visibleOutputs.map(({ output, index }) => {
          const label = output.isMine
            ? `Change ${++changeNumber}`
            : output.role === 'unknown'
              ? `Unknown output ${index + 1}`
              : `Recipient ${++recipientNumber}`;

          return uiRow(
            label,
            detailValue(formatBtcValue(output.valueSats), `${outputDetailLabel(output)} - ${truncateMiddle(output.address, 12, 8)}`),
            output.role === 'unknown' ? 'warning' : undefined,
          );
        })
      : [uiMuted('No recipient or change outputs parsed. Review the totals above.')];
  const dataOutputRows = visibleDataOutputs.map(({ output, index }) =>
    uiRow(
      output.vaultData ? `Vault data #${index + 1}` : output.role === 'op_return' ? `Data #${index + 1}` : `Unknown data #${index + 1}`,
      detailValue(formatBtcValue(output.valueSats), output.vaultData ? vaultDataDetail(output.vaultData) : truncateMiddle(output.address, 24, 8)),
      output.role === 'unknown' ? 'warning' : undefined,
    ),
  );

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiCard({
          description: `${originNameLabel(origin)} - ${networkLabel(summary.network)}`,
          extra: leavesWalletSats === null ? 'review details' : 'you pay',
          image: DUCAT_MARK_SVG,
          title: action,
          value: formatMaybeBtcValue(leavesWalletSats),
        }),
        uiBanner(statusTitle, statusSeverity, statusBody),
        ...vaultActionSection(displayContext),
        uiSection([
          uiHeading('Approval summary'),
          uiMuted(actionIntent(displayContext)),
          amountCard('You pay', leavesWalletSats, 'Recipient value plus Bitcoin miner fee'),
          amountCard(recipientTitle, summary.externalOutputSats, recipientDescription),
          amountCard('Change', summary.selfOutputSats, compactCount(changeOutputCount, 'Ducat output')),
          compactReviewLine('Network fee', summary.feeSats, 'Bitcoin miner fee', summary.feeSats === null ? 'warning' : undefined),
        ]),
        uiSection([
          uiHeading('Signing check'),
          countCard('Ducat signs', `${summary.signedInputIndexes.length} of ${summary.inputCount}`, inputRoleLabel, signedInputs || 'No requested inputs'),
          uiRow(
            'Safety',
            inlineSecurity(
              visibleWarnings.length ? 'Warnings need review' : 'Only Snap-managed inputs',
              visibleWarnings.length ? 'warning' : 'success',
            ),
            visibleWarnings.length ? 'warning' : undefined,
          ),
        ]),
        ...cosignSection,
        ...timeoutSection,
        ...(summary.unitInputs.length
          ? [uiCollapsibleSection(`Verified UNIT inputs (${summary.unitInputs.length})`, unitEvidenceRows(summary), true)]
          : []),
        uiCollapsibleSection(
          `Inspect signed inputs (${summary.signedInputs.length})`,
          [...inputRows, ...(summary.signedInputs.length > visibleSignedInputs.length ? [uiMuted(`+ ${summary.signedInputs.length - visibleSignedInputs.length} more inputs`)] : [])],
        ),
        uiCollapsibleSection(
          `Inspect outputs (${recipientOutputs.length})`,
          [...outputRows, ...(hiddenOutputs.length ? [uiMuted(`+ ${hiddenOutputs.length} more outputs; hidden external total ${formatSats(hiddenExternalSats, summary.network)}`)] : [])],
        ),
        ...(reviewDataOutputs.length
          ? [
              uiCollapsibleSection(
                `Inspect data outputs (${reviewDataOutputs.length})`,
                [
                  ...dataOutputRows,
                  ...(reviewDataOutputs.length > visibleDataOutputs.length ? [uiMuted(`+ ${reviewDataOutputs.length - visibleDataOutputs.length} more data outputs`)] : []),
                ],
              ),
            ]
          : []),
        ...(visibleWarnings.length > 1
          ? [uiCollapsibleSection('More warnings', visibleWarnings.slice(1).map((warning) => uiText(warning, { color: 'warning' })))]
          : []),
        uiDivider(),
        uiMuted('Approve only if these amounts match the Ducat app. Private keys stay inside MetaMask.'),
      ]),
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected Ducat transaction signing.');
  }
}

/**
 * Requires one all-or-nothing approval for a bounded PSBT batch with visible aggregate fees.
 * @param params - Verified batch summaries and request context.
 * @returns Only after explicit user approval of the complete batch.
 * @throws When any fee is unavailable or approval is denied.
 */
export async function confirmBatch(params: {
  origin: string;
  entries: { summary: PsbtSummary; context?: DucatActionContext }[];
  context?: DucatActionContext;
}): Promise<void> {
  const summaries = params.entries.map((entry) => entry.summary);

  // Same hard-stop as confirmPsbt: refuse the whole batch if any transaction's miner fee cannot
  // be computed, so the user is never asked to approve a batch whose total outflow is hidden.
  const unavailableFeeEntry = summaries.findIndex((summary) => summary.feeSats === null);

  if (unavailableFeeEntry !== -1) {
    throw ducatError('PSBT_FEE_UNAVAILABLE', 'A transaction in this Ducat batch does not include enough value data to compute its Bitcoin miner fee, so the Snap cannot show the total you would pay and will not sign the batch.', {
      entryIndex: unavailableFeeEntry,
    });
  }

  const decodedBatchSummary = summaries.find((summary) => summary.vaultUpdates.length > 0);
  const displayContext = decodedBatchSummary ? contextFromDecodedVault(decodedBatchSummary, params.context) : (params.context ?? {});
  const feeTotal = sumNullable(summaries.map((summary) => summary.feeSats));
  const externalTotal = summaries.reduce((total, summary) => total + summary.externalOutputSats, 0);
  const netTotal = maybeAddSats(externalTotal, feeTotal);
  const signedInputCount = summaries.reduce((total, summary) => total + summary.signedInputIndexes.length, 0);
  const network = summaries[0]?.network ?? 'mutinynet';
  const warningCount = summaries.reduce((total, summary) => total + summary.warnings.length, 0);
  const visibleEntries = params.entries.slice(0, 6);
  const hiddenEntries = params.entries.slice(visibleEntries.length);
  const hiddenExternalTotal = hiddenEntries.reduce((total, entry) => total + entry.summary.externalOutputSats, 0);
  const statusTitle = warningCount ? 'Batch warnings' : 'Batch ready';
  const statusSeverity = warningCount ? 'warning' : 'success';
  const statusBody = warningCount
    ? `${warningCount} warning${warningCount === 1 ? '' : 's'} across this batch. Review each transaction before approving.`
    : 'Rejecting this request signs no PSBTs. Approving signs the full batch in order.';

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiCard({
          description: `${originNameLabel(params.origin)} - ${networkLabel(network)}`,
          extra: 'all-or-nothing',
          image: DUCAT_MARK_SVG,
          // Same provenance rule as confirmPsbt (SAY-02): only a vault-decoded batch gets a
          // Snap-verified action headline; otherwise the app's label is tagged "(app-provided)".
          title: `${decodedBatchSummary ? actionLabel(displayContext, 'Ducat') : unverifiedActionLabel(displayContext, 'Bitcoin')} batch`,
          value: formatMaybeBtcValue(netTotal),
        }),
        uiBanner(statusTitle, statusSeverity, statusBody),
        ...vaultActionSection(displayContext),
        uiSection([
          uiHeading('Approval summary'),
          uiMuted(actionIntent(displayContext)),
          amountCard('You pay', netTotal, 'Recipient values plus Bitcoin miner fees'),
          amountCard('Recipients', externalTotal, 'Total external outputs'),
          compactReviewLine('Network fees', feeTotal, 'across the full batch', feeTotal === null ? 'warning' : undefined),
        ]),
        uiSection([
          uiHeading('Signing check'),
          countCard('Transactions', `${summaries.length}`, 'All-or-nothing approval', `${signedInputCount} input${signedInputCount === 1 ? '' : 's'}`),
          uiRow(
            'Safety',
            inlineSecurity(
              warningCount ? 'Warnings need review' : 'Full batch signs in order',
              warningCount ? 'warning' : 'success',
            ),
            warningCount ? 'warning' : undefined,
          ),
        ]),
        uiCollapsibleSection(
          `Inspect transactions (${summaries.length})`,
          [
            ...visibleEntries.flatMap(({ summary, context }, index) => {
              const entryContext = contextFromDecodedVault(summary, context);

              return [
                uiRow(
                  `#${index + 1} ${actionLabel(entryContext, 'Transaction')}`,
                  detailValue(
                    formatMaybeBtcValue(maybeAddSats(summary.externalOutputSats, summary.feeSats)),
                    `${summary.signedInputIndexes.length} input${summary.signedInputIndexes.length === 1 ? '' : 's'} - fee ${formatMaybeBtcValue(summary.feeSats)}${
                      summary.warnings.length ? ` - ${summary.warnings.length} warning${summary.warnings.length === 1 ? '' : 's'}` : ''
                    }`,
                  ),
                  summary.warnings.length ? 'warning' : undefined,
                ),
                ...batchEntryRecipientRows(summary),
              ];
            }),
            ...(hiddenEntries.length
              ? [uiMuted(`+ ${hiddenEntries.length} more transaction${hiddenEntries.length === 1 ? '' : 's'} not itemized; hidden external total ${formatSats(hiddenExternalTotal, network)}`)]
              : []),
          ],
          true,
        ),
        ...(summaries.some((summary) => summary.unitInputs.length)
          ? [
              uiCollapsibleSection(
                `Verified UNIT inputs (${summaries.reduce((total, summary) => total + summary.unitInputs.length, 0)})`,
                summaries.flatMap(unitEvidenceRows),
              ),
            ]
          : []),
        uiDivider(),
        uiMuted('Approve only if every transaction and recipient matches the Ducat app flow.'),
      ]),
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected Ducat batch signing.');
  }
}
