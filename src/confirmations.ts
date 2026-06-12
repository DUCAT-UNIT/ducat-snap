import { crypto } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import {
  actionLabel,
  formatBtcValue,
  formatMetadataKey,
  formatMaybeBtcValue,
  formatMaybeSats,
  formatSats,
  formatSatsOnly,
  networkLabel,
  originLabel,
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

function amountCard(title: string, sats: number | null, description: string): SnapElement {
  return uiCard({
    description,
    extra: sats === null ? undefined : formatSatsOnly(sats),
    title,
    value: formatMaybeBtcValue(sats),
  });
}

function compactCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function signedInputLabel(role: DucatAddressRole): string {
  return role === 'sats' ? 'BTC input' : 'Vault input';
}

function outputSummaryLabel(output: PsbtOutputSummary): string {
  if (output.role === 'op_return') {
    return 'Data';
  }

  if (output.role === 'unknown') {
    return 'Unknown';
  }

  return output.isMine ? 'Change' : 'External';
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

function contextSection(context?: DucatActionContext): SnapElement[] {
  const metadata = Object.entries(context?.metadata ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (!metadata.length) {
    return [];
  }

  return [
    uiCollapsibleSection('Ducat app context', [
      uiMuted('App labels are shown for context. Parsed PSBT values above are what the Snap signs.'),
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

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiHeading(`Review ${actionLabel(params.context, 'message signing')}`, 'lg'),
        uiMuted(`${originLabel(params.origin)} - ${networkLabel(params.network)}`),
        uiSection([
          uiHeading('Signature'),
          uiRow('Account', detailValue(roleLabel(params.role), truncateMiddle(params.address))),
          uiRow('Type', 'BIP322 simple'),
          uiRow('Message length', `${params.message.length} characters`),
          uiRow('SHA256', `${messageSha256.slice(0, 16)}...${messageSha256.slice(-8)}`),
        ]),
        uiSection([
          uiHeading(isTruncated ? 'Message preview' : 'Message'),
          ...(isTruncated ? [uiMuted('Showing the first 800 characters. Copyable value is exactly what will be signed.')] : []),
          uiCopyable(displayedMessage),
        ]),
        ...contextSection(params.context),
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
  const visibleWarnings = summary.warnings.map((warning) => warning.trim()).filter(Boolean);
  const recipientOutputs = summary.outputs
    .map((output, index) => ({ index, output }))
    .filter(({ output }) => !isDataOutput(output));
  const dataOutputCount = summary.outputs.length - recipientOutputs.length;
  const visibleOutputs = recipientOutputs.slice(0, 8);
  const hiddenOutputs = recipientOutputs.slice(visibleOutputs.length);
  const hiddenExternalSats = hiddenOutputs.filter(({ output }) => !output.isMine).reduce((total, { output }) => total + output.valueSats, 0);
  const visibleSignedInputs = [...summary.signedInputs].sort((left, right) => left.index - right.index).slice(0, 6);
  const inputRows =
    visibleSignedInputs.length > 0
      ? visibleSignedInputs.map((input) =>
          uiRow(
            `#${input.index}`,
            detailValue(formatMaybeBtcValue(input.valueSats), `${signedInputLabel(input.role)} - ${truncateMiddle(input.address, 10, 8)}`),
            input.verification === 'alpha-unverified-taproot-script-path' ? 'warning' : undefined,
            input.verification === 'alpha-unverified-taproot-script-path'
              ? 'This alpha Taproot script-path input contains the Ducat vault key but could not be fully recomputed against the prevout.'
              : undefined,
          ),
        )
      : [uiMuted('No inputs requested for signing.')];
  const outputRows =
    visibleOutputs.length > 0
      ? visibleOutputs.map(({ output, index }) =>
          uiRow(
            `#${index + 1} ${outputSummaryLabel(output)}`,
            detailValue(formatBtcValue(output.valueSats), `${outputDetailLabel(output)} - ${truncateMiddle(output.address, 12, 8)}`),
            output.role === 'unknown' ? 'warning' : undefined,
          ),
        )
      : [uiMuted('No recipient or change outputs parsed. Review the totals above.')];

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiHeading(`Review ${action}`, 'lg'),
        uiMuted(`${originLabel(origin)} - ${networkLabel(summary.network)}`),
        ...(visibleWarnings.length ? [uiBanner('Needs attention', 'warning', visibleWarnings[0])] : []),
        uiSection([
          uiHeading('At a glance'),
          amountCard('Spend', summary.signedInputValueSats, `${compactCount(summary.signedInputIndexes.length, 'input')} signed`),
          amountCard('To recipients', summary.externalOutputSats, 'Leaves Ducat Snap accounts'),
          amountCard('Change', summary.selfOutputSats, 'Returns to Ducat Snap accounts'),
          amountCard('Network fee', summary.feeSats, 'Paid to Bitcoin miners'),
        ]),
        uiSection([
          uiHeading('Signing scope'),
          uiRow('Inputs signed', detailValue(`${summary.signedInputIndexes.length} of ${summary.inputCount}`, signedInputs || 'No requested inputs')),
          uiRow('Network', networkLabel(summary.network)),
          ...(dataOutputCount ? [uiRow('Data outputs', `${dataOutputCount} non-spendable output${dataOutputCount === 1 ? '' : 's'}`)] : []),
        ]),
        uiCollapsibleSection(
          'Signed inputs',
          [...inputRows, ...(summary.signedInputs.length > visibleSignedInputs.length ? [uiMuted(`+ ${summary.signedInputs.length - visibleSignedInputs.length} more inputs`)] : [])],
          true,
        ),
        uiCollapsibleSection(
          'Recipients and change',
          [...outputRows, ...(hiddenOutputs.length ? [uiMuted(`+ ${hiddenOutputs.length} more outputs; hidden external total ${formatSats(hiddenExternalSats, summary.network)}`)] : [])],
          true,
        ),
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
  const feeTotal = summaries.reduce<number | null>((total, summary) => {
    if (total === null || summary.feeSats === null) {
      return null;
    }

    return total + summary.feeSats;
  }, 0);
  const network = summaries[0]?.network ?? 'mutinynet';
  const warningCount = summaries.reduce((total, summary) => total + summary.warnings.length, 0);
  const visibleEntries = params.entries.slice(0, 6);

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiHeading(`Review ${actionLabel(params.context, 'Ducat')} batch`, 'lg'),
        uiMuted(`${originLabel(params.origin)} - ${networkLabel(network)}`),
        ...(warningCount ? [uiBanner('Batch warnings', 'warning', `${warningCount} warning${warningCount === 1 ? '' : 's'} across this batch.`)] : []),
        uiSection([
          uiHeading('At a glance'),
          uiCard({
            description: 'Signed together',
            title: 'Transactions',
            value: `${summaries.length}`,
          }),
          amountCard('Total fee', feeTotal, 'Across the full batch'),
          uiRow('Approval', 'All-or-nothing'),
          uiMuted('Rejecting this request signs no PSBTs.'),
        ]),
        uiCollapsibleSection(
          'Transactions',
          [
            ...visibleEntries.map(({ summary, context }, index) =>
              uiRow(
                `#${index + 1} ${actionLabel(context, 'Transaction')}`,
                detailValue(
                  `${summary.signedInputIndexes.length} input${summary.signedInputIndexes.length === 1 ? '' : 's'}`,
                  `External ${formatBtcValue(summary.externalOutputSats)} - fee ${formatMaybeSats(summary.feeSats, summary.network)}`,
                ),
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
        uiHeading('Review Send BTC', 'lg'),
        uiMuted(`${originLabel(params.origin)} - ${networkLabel(params.network)}`),
        uiSection([
          uiHeading('At a glance'),
          amountCard('Recipient gets', params.amountSats, 'BTC transfer amount'),
          amountCard('Total debit', params.amountSats + params.feeSats, 'Amount plus network fee'),
          amountCard('Network fee', params.feeSats, `${params.feeRate} sat/vB`),
          amountCard('Change', params.changeSats, 'Returns to BTC account'),
        ]),
        uiCollapsibleSection('Route', [
          uiRow('From', detailValue('BTC account', truncateMiddle(params.from))),
          uiRow('To', truncateMiddle(params.to)),
          uiRow('Selected UTXOs', detailValue(`${params.inputCount} input${params.inputCount === 1 ? '' : 's'}`, formatSats(params.inputValueSats, params.network))),
          uiRow('Broadcast', truncateMiddle(params.broadcastEndpoint, 28, 10)),
        ], true),
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
        uiHeading('Clear recent actions', 'lg'),
        uiSection([
          uiRow('Origin', originLabel(origin)),
          uiMuted('This clears only the recent Ducat action history shown on Snap Home. Accounts, keys, vaults, balances, and transactions are unchanged.'),
        ]),
      ]),
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected clearing Ducat recent actions.');
  }
}
