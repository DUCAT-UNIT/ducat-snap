import { btcUnit } from './networks';
import type { DucatActionContext, DucatNetwork, PsbtSummary } from './types';
import { copyable, divider, heading, panel, text } from './ui';

function truncate(value: string, prefix = 10, suffix = 8): string {
  if (value.length <= prefix + suffix + 3) {
    return value;
  }

  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

function actionLabel(context?: DucatActionContext): string {
  return context?.title ?? context?.actionType ?? context?.flow ?? 'Ducat action';
}

function contextLines(context?: DucatActionContext): string[] {
  if (!context?.metadata) {
    return [];
  }

  return Object.entries(context.metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `**${key}:** ${String(value).slice(0, 140)}`)
    .slice(0, 8);
}

export async function confirmMessage(params: {
  origin: string;
  network: DucatNetwork;
  address: string;
  message: string;
  context?: DucatActionContext;
}): Promise<void> {
  const displayedMessage = params.message.slice(0, 800);
  const isTruncated = displayedMessage.length < params.message.length;

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading(`Sign ${actionLabel(params.context)}`),
        text(`**Origin:** ${params.origin}`),
        text(`**Network:** ${params.network}`),
        text(`**Address:** ${truncate(params.address)}`),
        divider(),
        text(`**Message${isTruncated ? ' (first 800 characters)' : ''}:**`),
        copyable(displayedMessage),
      ]),
    },
  });

  if (!confirmed) {
    throw new Error('User rejected Ducat message signing.');
  }
}

export async function confirmPsbt(params: {
  origin: string;
  summary: PsbtSummary;
  context?: DucatActionContext;
}): Promise<void> {
  const { summary, context, origin } = params;
  const signedInputs = summary.signedInputIndexes.join(', ');
  const feeLine = summary.feeSats === null ? 'Unavailable' : `${summary.feeSats} sats`;
  const outputLines = summary.outputs.slice(0, 8).map((output, index) => {
    const label = output.isMine ? 'change/self' : 'external';

    return `${index + 1}. ${truncate(output.address, 16, 10)} - ${output.valueSats} sats (${label})`;
  });

  const extraOutputCount = Math.max(0, summary.outputs.length - outputLines.length);

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading(`Confirm ${actionLabel(context)}`),
        text(`**Origin:** ${origin}`),
        text(`**Network:** ${summary.network}`),
        text(`**Inputs:** ${summary.inputCount} total; signing indexes ${signedInputs || 'none'}`),
        text(`**Outputs:** ${summary.outputCount}`),
        text(`**Fee:** ${feeLine}`),
        divider(),
        text(`**Output summary (${btcUnit(summary.network)}):**`),
        ...outputLines.map((line) => text(line)),
        ...(extraOutputCount ? [text(`+ ${extraOutputCount} more outputs`)] : []),
        ...contextLines(context).map((line) => text(line)),
      ]),
    },
  });

  if (!confirmed) {
    throw new Error('User rejected Ducat transaction signing.');
  }
}

export async function confirmBatch(params: {
  origin: string;
  summaries: PsbtSummary[];
  context?: DucatActionContext;
}): Promise<void> {
  const feeTotal = params.summaries.reduce<number | null>((total, summary) => {
    if (total === null || summary.feeSats === null) {
      return null;
    }

    return total + summary.feeSats;
  }, 0);

  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading(`Confirm ${actionLabel(params.context)} batch`),
        text(`**Origin:** ${params.origin}`),
        text(`**Transactions:** ${params.summaries.length}`),
        text(`**Network:** ${params.summaries[0]?.network ?? 'unknown'}`),
        text(`**Total fee:** ${feeTotal === null ? 'Unavailable' : `${feeTotal} sats`}`),
        divider(),
        ...params.summaries.slice(0, 6).map((summary, index) =>
          text(
            `${index + 1}. signing inputs ${summary.signedInputIndexes.join(', ') || 'none'}; outputs ${summary.outputCount}; fee ${
              summary.feeSats === null ? 'unknown' : `${summary.feeSats} sats`
            }`,
          ),
        ),
        ...(params.summaries.length > 6 ? [text(`+ ${params.summaries.length - 6} more transactions`)] : []),
        ...contextLines(params.context).map((line) => text(line)),
      ]),
    },
  });

  if (!confirmed) {
    throw new Error('User rejected Ducat batch signing.');
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
}): Promise<void> {
  const confirmed = await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading('Send Bitcoin'),
        text(`**Origin:** ${params.origin}`),
        text(`**Network:** ${params.network}`),
        text(`**From:** ${truncate(params.from)}`),
        text(`**To:** ${truncate(params.to)}`),
        text(`**Amount:** ${params.amountSats} sats`),
        text(`**Fee:** ${params.feeSats} sats at ${params.feeRate} sat/vB`),
      ]),
    },
  });

  if (!confirmed) {
    throw new Error('User rejected Ducat transfer.');
  }
}
