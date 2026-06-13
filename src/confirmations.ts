import { crypto } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { DUCAT_MARK_SVG } from './brand';
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

function maybeAddSats(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
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

function warningTitle(warnings: string[]): string {
  if (warnings.some((warning) => warning.startsWith('Alpha compatibility path'))) {
    return 'Alpha compatibility';
  }

  return 'Review before signing';
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
        uiCard({
          description: `${originLabel(params.origin)} - ${networkLabel(params.network)}`,
          extra: roleLabel(params.role),
          image: DUCAT_MARK_SVG,
          title: actionLabel(params.context, 'Message signing'),
          value: 'BIP322',
        }),
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
            signedInputTitle(input.role),
            detailValue(formatMaybeBtcValue(input.valueSats), `PSBT #${input.index} - ${truncateMiddle(input.address, 10, 8)}`),
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

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: uiBox([
        uiCard({
          description: `${originNameLabel(origin)} - ${networkLabel(summary.network)}`,
          extra: leavesWalletSats === null ? 'review details' : 'leaves wallet',
          image: DUCAT_MARK_SVG,
          title: action,
          value: formatMaybeBtcValue(leavesWalletSats),
        }),
        uiBanner(statusTitle, statusSeverity, statusBody),
        uiSection([
          uiHeading('At a glance'),
          compactReviewLine('Net spend', leavesWalletSats, 'recipient amount plus network fee', leavesWalletSats === null ? 'warning' : undefined),
          compactReviewLine('Recipients', summary.externalOutputSats, compactCount(externalOutputCount, 'external output')),
          compactReviewLine('Change back', summary.selfOutputSats, compactCount(changeOutputCount, 'Ducat output')),
          compactReviewLine('Network fee', summary.feeSats, 'Bitcoin miner fee', summary.feeSats === null ? 'warning' : undefined),
        ]),
        uiSection([
          uiHeading('Security check'),
          uiRow('App', detailValue(originNameLabel(origin), originUrlLabel(origin))),
          uiRow('Network', networkLabel(summary.network)),
          uiRow('Signing', detailValue(`${summary.signedInputIndexes.length} of ${summary.inputCount} inputs`, signedInputs || 'No requested inputs')),
          uiRow('Accounts', inputRoleLabel),
          uiRow('Private keys', 'Stay inside MetaMask'),
          ...(dataOutputCount ? [uiRow('Data outputs', `${dataOutputCount} non-spendable output${dataOutputCount === 1 ? '' : 's'}`)] : []),
        ]),
        uiCollapsibleSection(
          `Inputs being signed (${summary.signedInputs.length})`,
          [...inputRows, ...(summary.signedInputs.length > visibleSignedInputs.length ? [uiMuted(`+ ${summary.signedInputs.length - visibleSignedInputs.length} more inputs`)] : [])],
        ),
        uiCollapsibleSection(
          `Recipient and change outputs (${recipientOutputs.length})`,
          [...outputRows, ...(hiddenOutputs.length ? [uiMuted(`+ ${hiddenOutputs.length} more outputs; hidden external total ${formatSats(hiddenExternalSats, summary.network)}`)] : [])],
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
        uiCard({
          description: `${originLabel(params.origin)} - ${networkLabel(network)}`,
          extra: 'transactions',
          image: DUCAT_MARK_SVG,
          title: `${actionLabel(params.context, 'Ducat')} batch`,
          value: `${summaries.length}`,
        }),
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
        uiCard({
          description: `${originLabel(params.origin)} - ${networkLabel(params.network)}`,
          extra: 'recipient gets',
          image: DUCAT_MARK_SVG,
          title: 'Send BTC',
          value: formatBtcValue(params.amountSats),
        }),
        uiSection([
          uiHeading('Money movement'),
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
