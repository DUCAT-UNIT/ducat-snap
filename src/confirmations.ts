import { crypto } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { DUCAT_MARK_SVG } from './brand';
import {
  actionLabel,
  formatBtcValue,
  formatMetadataKey,
  formatMaybeBtcValue,
  formatSats,
  formatSatsOnly,
  networkLabel,
  originNameLabel,
  originUrlLabel,
  roleLabel,
  truncateMiddle,
} from './display';
import { ducatError } from './errors';
import type { DucatActionContext, DucatAddressRole, DucatNetwork, PsbtOutputSummary, PsbtSummary } from './types';
import {
  uiBanner,
  uiBox,
  uiCard,
  uiCollapsibleSection,
  uiCopyable,
  uiDivider,
  uiHeading,
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
  return role === 'sats' ? 'BTC account' : 'UNIT / Vault';
}

function outputDetailLabel(output: PsbtOutputSummary): string {
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

function warningTitle(warnings: string[]): string {
  if (warnings.some((warning) => warning.startsWith('Alpha compatibility path'))) {
    return 'Alpha compatibility';
  }

  return 'Review before signing';
}

function actionKey(context?: DucatActionContext): string | null {
  const raw = context?.actionType ?? context?.flow ?? context?.title;

  return raw ? raw.trim().toLowerCase().replace(/_/gu, '-').replace(/ /gu, '-') : null;
}

function actionIntent(context?: DucatActionContext): string {
  switch (actionKey(context)) {
    case 'borrow':
      return 'Borrow request: review vault inputs, UNIT settlement outputs, and the Bitcoin fee before signing.';
    case 'create':
      return 'Vault creation: review the funding outputs and any change before signing.';
    case 'deposit':
      return 'BTC deposit: review the collateral amount, change, and Bitcoin fee before signing.';
    case 'liquidation':
    case 'liquidation-or-repossess':
    case 'repossess':
      return 'Liquidation flow: review every spend and output carefully before approving.';
    case 'repay':
      return 'Repay request: review UNIT repayment outputs, vault inputs, and the Bitcoin fee before signing.';
    case 'swap':
      return 'Swap request: review the external output amount, change, and fee before signing.';
    case 'withdraw':
      return 'BTC withdrawal: review the destination, returned change, and Bitcoin fee before signing.';
    default:
      return 'Review parsed Bitcoin transaction amounts before signing.';
  }
}

function contextSection(context?: DucatActionContext, note = 'App labels are shown for context. Parsed PSBT values above are what the Snap signs.'): SnapElement[] {
  const metadata = Object.entries(context?.metadata ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (!metadata.length) {
    return [];
  }

  return [
    uiCollapsibleSection('Ducat app context', [
      uiMuted(note),
      ...metadata.slice(0, 8).map(([key, value]) => uiRow(formatMetadataKey(key), String(value).slice(0, 140))),
    ]),
  ];
}

export async function confirmMessage(params: {
  origin: string;
  network: DucatNetwork;
  address: string;
  role: DucatAddressRole;
  message: string;
  context?: DucatActionContext;
}): Promise<void> {
  const displayedMessage = params.message.slice(0, 800);
  const isTruncated = displayedMessage.length < params.message.length;
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
          isTruncated ? 'Message preview' : 'Message to sign',
          [
            uiMuted('Copyable value is exactly what will be signed.'),
            ...(isTruncated ? [uiMuted('Showing the first 800 characters.')] : []),
            uiCopyable(displayedMessage),
          ],
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

export async function confirmPsbt(params: {
  origin: string;
  summary: PsbtSummary;
  context?: DucatActionContext;
}): Promise<void> {
  const { summary, context, origin } = params;
  const signedInputs = summary.signedInputIndexes.map((index) => `#${index}`).join(', ');
  const action = actionLabel(context, 'Ducat transaction');
  const leavesWalletSats = maybeAddSats(summary.externalOutputSats, summary.feeSats);
  const visibleWarnings = summary.warnings.map((warning) => warning.trim()).filter(Boolean);
  const recipientOutputs = summary.outputs
    .map((output, index) => ({ index, output }))
    .filter(({ output }) => !isDataOutput(output));
  const externalOutputCount = recipientOutputs.filter(({ output }) => !output.isMine).length;
  const changeOutputCount = recipientOutputs.filter(({ output }) => output.isMine).length;
  const dataOutputCount = summary.outputs.length - recipientOutputs.length;
  const visibleOutputs = recipientOutputs.slice(0, 8);
  const hiddenOutputs = recipientOutputs.slice(visibleOutputs.length);
  const hiddenExternalSats = hiddenOutputs.filter(({ output }) => !output.isMine).reduce((total, { output }) => total + output.valueSats, 0);
  const dataOutputs = summary.outputs.map((output, index) => ({ index, output })).filter(({ output }) => isDataOutput(output));
  const visibleDataOutputs = dataOutputs.slice(0, 4);
  const visibleSignedInputs = [...summary.signedInputs].sort((left, right) => left.index - right.index).slice(0, 6);
  const inputRoleLabel = [...new Set(summary.signedInputs.map((input) => roleLabel(input.role)))].join(' + ') || 'No Ducat account inputs';
  const statusTitle = visibleWarnings.length ? warningTitle(visibleWarnings) : 'Verified by Ducat Snap';
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
            input.verification === 'alpha-unverified-taproot-script-path' ? 'warning' : undefined,
            input.verification === 'alpha-unverified-taproot-script-path'
              ? 'This alpha Taproot script-path input contains the Ducat vault key but could not be fully recomputed against the prevout.'
              : undefined,
          ),
        )
      : [uiMuted('No inputs requested for signing.')];
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
      output.role === 'op_return' ? `Data #${index + 1}` : `Unknown data #${index + 1}`,
      detailValue(formatBtcValue(output.valueSats), truncateMiddle(output.address, 24, 8)),
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
          extra: leavesWalletSats === null ? 'review details' : 'total debit',
          image: DUCAT_MARK_SVG,
          title: action,
          value: formatMaybeBtcValue(leavesWalletSats),
        }),
        uiBanner(statusTitle, statusSeverity, statusBody),
        uiSection([
          uiHeading('Money movement'),
          uiMuted(actionIntent(context)),
          amountCard('Leaves wallet', leavesWalletSats, 'Recipient value plus Bitcoin miner fee'),
          amountCard('Recipients', summary.externalOutputSats, compactCount(externalOutputCount, 'external output')),
          amountCard('Change back', summary.selfOutputSats, compactCount(changeOutputCount, 'Ducat output')),
          compactReviewLine('Network fee', summary.feeSats, 'Bitcoin miner fee', summary.feeSats === null ? 'warning' : undefined),
        ]),
        uiCollapsibleSection('Request details', [
          uiRow('App', detailValue(originNameLabel(origin), originUrlLabel(origin))),
          uiRow('Network', networkLabel(summary.network)),
          uiRow('Signing', detailValue(`${summary.signedInputIndexes.length} of ${summary.inputCount} inputs`, signedInputs || 'No requested inputs')),
          uiRow('Accounts', inputRoleLabel),
          uiRow('Private keys', 'Stay inside MetaMask'),
          ...(dataOutputCount ? [uiRow('Data outputs', `${dataOutputCount} non-spendable output${dataOutputCount === 1 ? '' : 's'}`)] : []),
        ]),
        uiCollapsibleSection(
          `Inspect signed inputs (${summary.signedInputs.length})`,
          [...inputRows, ...(summary.signedInputs.length > visibleSignedInputs.length ? [uiMuted(`+ ${summary.signedInputs.length - visibleSignedInputs.length} more inputs`)] : [])],
        ),
        uiCollapsibleSection(
          `Inspect outputs (${recipientOutputs.length})`,
          [...outputRows, ...(hiddenOutputs.length ? [uiMuted(`+ ${hiddenOutputs.length} more outputs; hidden external total ${formatSats(hiddenExternalSats, summary.network)}`)] : [])],
        ),
        ...(dataOutputs.length
          ? [
              uiCollapsibleSection(
                `Inspect data outputs (${dataOutputs.length})`,
                [...dataOutputRows, ...(dataOutputs.length > visibleDataOutputs.length ? [uiMuted(`+ ${dataOutputs.length - visibleDataOutputs.length} more data outputs`)] : [])],
              ),
            ]
          : []),
        ...(visibleWarnings.length > 1
          ? [uiCollapsibleSection('More warnings', visibleWarnings.slice(1).map((warning) => uiText(warning, { color: 'warning' })))]
          : []),
        ...contextSection(context),
        uiDivider(),
        uiMuted('Approve only if these amounts match the Ducat app. Private keys stay inside MetaMask.'),
      ]),
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected Ducat transaction signing.');
  }
}

export async function confirmBatch(params: {
  origin: string;
  entries: { summary: PsbtSummary; context?: DucatActionContext }[];
  context?: DucatActionContext;
}): Promise<void> {
  const summaries = params.entries.map((entry) => entry.summary);
  const feeTotal = sumNullable(summaries.map((summary) => summary.feeSats));
  const externalTotal = summaries.reduce((total, summary) => total + summary.externalOutputSats, 0);
  const netTotal = maybeAddSats(externalTotal, feeTotal);
  const signedInputCount = summaries.reduce((total, summary) => total + summary.signedInputIndexes.length, 0);
  const network = summaries[0]?.network ?? 'mutinynet';
  const warningCount = summaries.reduce((total, summary) => total + summary.warnings.length, 0);
  const visibleEntries = params.entries.slice(0, 6);
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
          title: `${actionLabel(params.context, 'Ducat')} batch`,
          value: formatMaybeBtcValue(netTotal),
        }),
        uiBanner(statusTitle, statusSeverity, statusBody),
        uiSection([
          uiHeading('Batch summary'),
          uiRow('Transactions', `${summaries.length}`),
          uiMuted(actionIntent(params.context)),
          amountCard('Leaves wallet', netTotal, 'Recipient values plus Bitcoin miner fees'),
          amountCard('Recipients', externalTotal, 'Total external outputs'),
          compactReviewLine('Network fees', feeTotal, 'across the full batch', feeTotal === null ? 'warning' : undefined),
          uiRow('Signing', `${signedInputCount} input${signedInputCount === 1 ? '' : 's'}`),
        ]),
        uiCollapsibleSection('Request details', [
          uiRow('App', detailValue(originNameLabel(params.origin), originUrlLabel(params.origin))),
          uiRow('Network', networkLabel(network)),
          uiRow('Approval', 'All-or-nothing'),
          uiRow('Private keys', 'Stay inside MetaMask'),
        ]),
        uiCollapsibleSection(
          `Inspect transactions (${summaries.length})`,
          [
            ...visibleEntries.map(({ summary, context }, index) =>
              uiRow(
                `#${index + 1} ${actionLabel(context, 'Transaction')}`,
                detailValue(
                  formatMaybeBtcValue(maybeAddSats(summary.externalOutputSats, summary.feeSats)),
                  `${summary.signedInputIndexes.length} input${summary.signedInputIndexes.length === 1 ? '' : 's'} - fee ${formatMaybeBtcValue(summary.feeSats)}${
                    summary.warnings.length ? ` - ${summary.warnings.length} warning${summary.warnings.length === 1 ? '' : 's'}` : ''
                  }`,
                ),
                summary.warnings.length ? 'warning' : undefined,
              ),
            ),
            ...(params.entries.length > visibleEntries.length ? [uiMuted(`+ ${params.entries.length - visibleEntries.length} more transactions`)] : []),
          ],
          true,
        ),
        ...contextSection(params.context),
        uiDivider(),
        uiMuted('Approve only if every transaction matches the Ducat app flow.'),
      ]),
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected Ducat batch signing.');
  }
}

export async function confirmTransfer(params: {
  origin: string;
  network: DucatNetwork;
  from: string;
  to: string;
  amountSats: number;
  feeSats: number;
  feeRate: number;
  changeSats: number;
  inputCount: number;
  inputValueSats: number;
  broadcastEndpoint: string;
}): Promise<void> {
  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiCard({
          description: `${originNameLabel(params.origin)} - ${networkLabel(params.network)}`,
          extra: 'total debit',
          image: DUCAT_MARK_SVG,
          title: 'Send BTC',
          value: formatBtcValue(params.amountSats + params.feeSats),
        }),
        uiBanner('Ready to broadcast', 'warning', 'Approving signs and broadcasts this testnet BTC transfer. Check the recipient before continuing.'),
        uiSection([
          uiHeading('Money movement'),
          amountCard('Leaves wallet', params.amountSats + params.feeSats, 'Recipient value plus Bitcoin miner fee'),
          amountCard('Recipient gets', params.amountSats, 'BTC transfer amount'),
          compactReviewLine('Network fee', params.feeSats, `${params.feeRate} sat/vB`),
          compactReviewLine('Change back', params.changeSats, 'returns to BTC account'),
        ]),
        uiCollapsibleSection('Request details', [
          uiRow('App', detailValue(originNameLabel(params.origin), originUrlLabel(params.origin))),
          uiRow('Network', networkLabel(params.network)),
          uiRow('Private keys', 'Stay inside MetaMask'),
        ]),
        uiCollapsibleSection('Inspect route', [
          uiRow('From', uiCopyable(params.from)),
          uiRow('To', uiCopyable(params.to)),
          uiRow('Selected UTXOs', detailValue(`${params.inputCount} input${params.inputCount === 1 ? '' : 's'}`, formatSats(params.inputValueSats, params.network))),
          uiRow('Broadcast endpoint', uiCopyable(params.broadcastEndpoint)),
        ]),
        uiDivider(),
        uiMuted('Approve only if the recipient and total debit are correct.'),
      ]),
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected Ducat transfer.');
  }
}

export async function confirmClearRecentActions(origin: string): Promise<void> {
  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiCard({
          description: originNameLabel(origin),
          image: DUCAT_MARK_SVG,
          title: 'Clear recent actions',
          value: 'History',
        }),
        uiBanner('Snap Home only', 'info', 'This clears only the recent Ducat action history shown on Snap Home.'),
        uiSection([
          uiHeading('Security check'),
          uiRow('App', detailValue(originNameLabel(origin), originUrlLabel(origin))),
          uiRow('Accounts and keys', 'Unchanged'),
          uiRow('Balances and vaults', 'Unchanged'),
        ]),
      ]),
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected clearing Ducat recent actions.');
  }
}
