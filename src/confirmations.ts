/** @fileoverview Builds fail-closed confirmations from verified facts while separating untrusted app metadata. */
import { crypto } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { Image, Text } from '@metamask/snaps-sdk/jsx';

import { DUCAT_MARK_SVG } from './brand';
import { depositVaultRow, showDepositConfirmation } from './confirmation-vault';
import { vaultColoredValue } from './vault-colors';
import bitcoinIcon from './home-assets/bitcoin.svg';
import unitIcon from './home-assets/unit.svg';
import {
  actionLabel,
  formatBtcValue,
  formatInteger,
  formatMaybeBtcValue,
  formatSatsOnly,
  formatUnit,
  networkLabel,
  originNameLabel,
  originUrlLabel,
  roleLabel,
  truncateMiddle,
  unverifiedActionLabel,
} from './display';
import { ducatError } from './errors';
import type {
  DucatActionContext,
  DucatAddressRole,
  DeploymentId,
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
  return output.role === 'op_return';
}

function outputIdentity(output: PsbtOutputSummary): string {
  return output.role === 'unknown' ? output.scriptHex : output.address;
}

const MAX_CONFIRMATION_JSON_LENGTH = 10_000_000;

/** Refuses a confirmation tree that MetaMask cannot safely receive as JSON. */
export function assert_confirmation_content_fits(content: SnapElement): void {
  const jsonLength = JSON.stringify(content).length;

  if (jsonLength > MAX_CONFIRMATION_JSON_LENGTH) {
    throw ducatError(
      'CONFIRMATION_UI_TOO_LARGE',
      'This signing request would create a confirmation that is too large to review safely.',
      { jsonLength, maxJsonLength: MAX_CONFIRMATION_JSON_LENGTH },
    );
  }
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

  const collateralBtc = (vaultData.collateralBalanceSats ?? vaultData.collateralSats) / 100_000_000;

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

function depositSecondary(value: string): SnapElement {
  return uiText(value, { color: 'alternative', size: 'sm' });
}

type ConfirmationEntry = { summary: PsbtSummary; context?: DucatActionContext };

type VaultAction = 'create' | 'borrow' | 'repay' | 'deposit' | 'withdraw';
type VaultReview = { entry: ConfirmationEntry; entries: ConfirmationEntry[]; action: VaultAction; unitAmount?: number };

/** Choose a native action view only for an owned vault and its actual transaction package. */
function vaultReview(entries: ConfirmationEntry[]): VaultReview | undefined {
  const candidates = entries.filter(({ summary }) => summary.vaultUpdates.length > 0);
  if (candidates.length !== 1) return undefined;
  const entry = candidates[0];
  const { summary } = entry;
  const data = summary.vaultUpdates[0];
  if (summary.vaultUpdates.length !== 1 || !['create', 'borrow', 'repay', 'deposit', 'withdraw'].includes(data.actionType)) return undefined;
  const vaultOutputs = summary.outputs.filter((output) => output.role === 'vault' && output.isMine);
  if (data.collateralSats === undefined || vaultOutputs.length !== 1 || vaultOutputs[0].valueSats !== data.collateralSats) return undefined;
  const action = data.actionType as VaultAction;
  if (action === 'deposit' || action === 'withdraw') return entries.length === 1 ? { entry, entries, action } : undefined;
  if (entries.length !== 2 || entries[1] !== entry || entries[0].summary.network !== summary.network) return undefined;
  const parent = entries[0].summary;
  if (!parent.transactionId || !summary.inputs || !parent.unitTransfers) return undefined;
  const links = summary.inputs.filter((input) => input.outpoint.startsWith(`${parent.transactionId}:`));
  const expected = action === 'repay' ? [0] : [1, 2];
  if (links.length !== expected.length || expected.some((vout) => !links.some((input) => input.outpoint === `${parent.transactionId}:${vout}`))) return undefined;
  if (summary.inputCount !== (action === 'borrow' ? 3 : 2)) return undefined;
  if (action !== 'repay' && !(summary.outputs[0]?.isMine && summary.outputs[0].role === 'runes')) return undefined;
  const transfers = parent.unitTransfers.filter((transfer) => transfer.amountUnit > 0);
  if (transfers.length > 1 || (transfers.length === 0 && !(action === 'create' && data.unitBalanceUnit === 0))) return undefined;
  const transfer = transfers[0];
  if (transfer && transfer.outputIndex !== 1) return undefined;
  if (action === 'repay' && parent.outputs[1]?.role !== 'op_return') return undefined;
  if (action !== 'repay' && parent.outputs[1]?.role === 'op_return') return undefined;
  const before = verifiedBefore(summary);
  const delta = action === 'create' ? data.unitBalanceUnit : before
    ? action === 'repay' ? before.debtUnit - data.unitBalanceUnit : data.unitBalanceUnit - before.debtUnit : undefined;
  if (delta !== undefined && Math.abs(delta - (transfer?.amountUnit ?? 0)) > 0.00000001) return undefined;
  return { entry, entries, action, unitAmount: transfer?.amountUnit ?? 0 };
}

function verifiedBefore(summary: PsbtSummary): PsbtSummary['vaultBefore'] {
  const prior = summary.vaultBefore;
  if (!prior) return undefined;
  const input = summary.signedInputs.find((input) => input.index === prior.inputIndex && input.role === 'vault');
  return input?.valueSats === prior.collateralSats ? prior : undefined;
}

/** Prior collateral is known only when every input and the spent vault are identified. */
function depositBeforeCollateral(summary: PsbtSummary): number | undefined {
  const prior = verifiedBefore(summary);
  if (prior) return prior.collateralSats;
  const vaultOutput = summary.outputs.find((output) => output.isMine && output.role === 'vault');
  if (!vaultOutput || summary.signedInputs.length !== summary.inputCount) return undefined;
  const indexes = new Set(summary.signedInputs.map((input) => input.index));
  if (indexes.size !== summary.inputCount || summary.signedInputs.some((input) =>
    input.valueSats === null || !Number.isSafeInteger(input.valueSats) || input.valueSats < 0
    || input.index < 0 || input.index >= summary.inputCount
    || (input.role === 'vault' && input.address !== vaultOutput.address
      && input.verification !== 'committed-ducat-cosign-leaf')
  )) return undefined;
  const vaultInputs = summary.signedInputs.filter((input) => input.role === 'vault');
  if (vaultInputs.length !== 1) return undefined;
  const previousSats = vaultInputs[0].valueSats as number;
  return Number.isSafeInteger(previousSats) ? previousSats : undefined;
}

function vaultComparison(
  label: string,
  before: number | null | undefined,
  after: number | null | undefined,
  format: (value: number | null | undefined) => string,
  lowerIsBetter = false,
  beforeSuffix = '',
): SnapElement {
  const beforeText = before === undefined ? '—' : format(before);
  const afterText = after === undefined ? '—' : format(after);
  const changed = before !== undefined && after !== undefined && before !== after;
  const improved = changed && (after === null || (before !== null && after !== undefined && before !== undefined
    && (lowerIsBetter ? after < before : after > before)));
  const previous = Text({ children: `${beforeSuffix ? beforeText.replace(beforeSuffix, '') : beforeText} →`, color: 'alternative', size: 'md' });
  // Keep the text and image as direct flex siblings. A tooltip around only the
  // image adds an inline descender gap in MetaMask and lifts the colored value.
  return uiRow(label, uiBox([
    previous,
    changed ? vaultColoredValue(afterText, improved) : Text({ children: afterText, fontWeight: 'medium' }),
  ], { direction: 'horizontal', alignment: 'end', crossAlignment: 'center' }));
}

function depositOutputLabel(output: PsbtOutputSummary): string {
  if (output.vaultData) return 'Vault state';
  if (isDataOutput(output)) return 'Transaction data';
  if (output.role === 'unknown') return 'Unknown script';
  if (output.isMine) return output.role === 'vault' ? 'Your vault' : 'Change (you)';
  return 'External recipient';
}

/** All outputs, fees, warnings and signing evidence remain available in each native disclosure. */
function depositTransactionDetails(entry: ConfirmationEntry, step?: string): SnapElement {
  const { summary, context } = entry;
  const decoded = contextFromDecodedVault(summary, context);
  const label = summary.vaultUpdates.length > 0
    ? actionLabel(decoded, 'Vault update')
    : unverifiedActionLabel(decoded, 'Bitcoin transaction');
  const addresses = summary.outputs.filter((output) => !isDataOutput(output)).map((output, outputIndex) => uiBox([
    uiRow(`${outputIndex + 1}. ${depositOutputLabel(output)}`, formatBtcValue(output.valueSats)),
    uiCopyable(outputIdentity(output)),
  ]));

  return uiCollapsibleSection(step ?? label, [
    uiHeading(`Inputs (${summary.inputCount})`),
    ...(summary.inputs ?? summary.signedInputs).map((input) => uiRow(
      truncateMiddle(input.address, 10, 6),
      formatMaybeBtcValue(input.valueSats),
    )),
    ...(!summary.inputs && summary.inputCount > summary.signedInputs.length
      ? [depositSecondary(`${summary.inputCount - summary.signedInputs.length} other input(s) — not signed by this Snap.`)] : []),
    uiDivider(),
    uiHeading(`Outputs (${summary.outputCount})`),
    ...summary.outputs.map((output) =>
      uiRow(isDataOutput(output) || output.role === 'unknown' ? depositOutputLabel(output) : truncateMiddle(output.address, 10, 6),
        formatBtcValue(output.valueSats), output.role === 'unknown' ? 'warning' : undefined),
    ),
    uiDivider(),
    uiRow('Network fee', summary.feeSats === null ? 'Unavailable' : formatSatsOnly(summary.feeSats)),
    uiCollapsibleSection('Addresses & signing details', [
      depositSecondary(`Ducat signs ${summary.signedInputIndexes.length} of ${summary.inputCount} inputs. Only Snap-managed inputs are signed.`),
      ...summary.signedInputs.map((input) => uiBox([
        uiRow(`Input #${input.index}`, input.role === 'vault' && input.verification === 'matched-account-output' ? 'Vault account' : signedInputTitle(input.role)),
        uiCopyable(input.address),
      ])),
      ...addresses,
    ]),
  ]);
}

/** Five action variants share Home's native typography, icons and disclosure controls. */
function vaultConfirmation(origin: string, review: VaultReview): SnapElement {
  const { entry, entries, action } = review;
  const { summary } = entry;
  const data = summary.vaultUpdates[0];
  const vaultOutput = summary.outputs.find((output) => output.role === 'vault' && output.isMine)!;
  const before = verifiedBefore(summary);
  const beforeGross = action === 'create' ? 0 : depositBeforeCollateral(summary);
  const afterCollateral = data.collateralBalanceSats ?? data.collateralSats!;
  const reserve = data.collateralSats! - afterCollateral;
  const beforeCollateral = action === 'create' ? 0 : before?.collateralBalanceSats
    ?? (beforeGross === undefined ? undefined : Math.max(beforeGross - reserve, 0));
  const transactionPrice = data.unitPrice > 0 ? data.unitPrice : undefined;
  const beforeDebt = action === 'create' ? 0 : before?.debtUnit;
  const beforeRatio = beforeDebt === undefined || beforeCollateral === undefined ? undefined : vaultHealthFromReturnData({
    ...data, collateralSats: beforeCollateral, collateralBalanceSats: beforeCollateral, unitBalanceUnit: beforeDebt,
    unitPrice: transactionPrice ?? before?.unitPrice ?? 0,
  });
  const added = beforeGross !== undefined && data.collateralSats! > beforeGross ? data.collateralSats! - beforeGross : undefined;
  const btcReturned = summary.outputs.filter((output) => output.isMine && output.role === 'sats')
    .reduce((total, output) => total + output.valueSats, 0);
  const labels: Record<VaultAction, [string, string]> = {
    create: ['Open your vault', data.unitBalanceUnit > 0 ? 'Deposit BTC and borrow UNIT' : 'Start with BTC collateral'],
    borrow: ['Borrow UNIT', 'Borrow against your BTC collateral'],
    repay: ['Repay UNIT', data.unitBalanceUnit === 0 ? 'Clear your vault debt' : 'Reduce your vault debt'],
    deposit: ['Deposit to your vault', 'Add BTC collateral'],
    withdraw: ['Withdraw from your vault', 'Return BTC to your wallet'],
  };
  const amountLabel = action === 'borrow' ? 'You borrow' : action === 'repay' ? 'You repay'
    : action === 'withdraw' ? 'You receive' : added === undefined ? 'Vault collateral after' : 'You deposit';
  const amountSats = action === 'withdraw' ? btcReturned : added ?? data.collateralSats!;
  const isUnit = action === 'borrow' || action === 'repay';
  const signedInputs = entries.flatMap(({ summary }) => summary.signedInputs);
  const fees = entries.reduce((sum, { summary }) => sum + (summary.feeSats ?? 0), 0);
  const steps = action === 'create' ? [data.unitBalanceUnit > 0 ? 'Allocate UNIT' : 'Prepare vault funding', 'Open vault']
    : action === 'borrow' ? ['Allocate UNIT', 'Update vault'] : ['Repay UNIT', 'Update vault'];
  const comparison: typeof vaultComparison = (label, prior, next, format, lowerIsBetter, suffix) =>
    action === 'create' ? uiRow(label, detailValue(format(next)))
      : vaultComparison(label, prior, next, format, lowerIsBetter, suffix);
  return uiBox([
    uiBox([
      Image({ src: isUnit ? unitIcon : bitcoinIcon, alt: isUnit ? 'UNIT' : 'Bitcoin', width: 44, height: 44, borderRadius: 'full' }),
      uiBox([uiHeading(labels[action][0], 'md'), uiText(labels[action][1], { color: 'alternative' })]),
    ], { direction: 'horizontal', crossAlignment: 'center' }),
    depositSecondary(`${originNameLabel(origin)} · ${summary.network === 'mutinynet' ? 'Testnet' : summary.network === 'mainnet' ? 'Mainnet' : 'Regtest'}`),
    ...entries.flatMap(({ summary }, index) => summary.warnings.filter((warning) => warning.trim()).map((warning) =>
      uiBanner(entries.length > 1 ? `Transaction ${index + 1}` : 'Review before signing', 'warning', warning))),
    uiSection([
      depositSecondary(amountLabel),
      uiHeading(isUnit ? formatMaybeUnitValue(review.unitAmount) : formatBtcValue(amountSats), 'lg'),
      ...(!isUnit && transactionPrice ? [depositSecondary(`≈ ${formatMaybeUsd(amountSats / 100_000_000 * transactionPrice)} at transaction price`)] : []),
      ...(action === 'create' ? [uiRow('You borrow', formatUnit(data.unitBalanceUnit)),
        ...(data.collateralBalanceSats !== undefined && data.collateralSats! > data.collateralBalanceSats
          ? [uiRow('Vault reserve', formatSatsOnly(data.collateralSats! - data.collateralBalanceSats))] : [])] : []),
      ...(action === 'repay' && btcReturned > 0 ? [uiRow('BTC returned to you', formatBtcValue(btcReturned))] : []),
      ...(action === 'borrow' && added ? [uiRow('BTC added to vault', formatBtcValue(added))] : []),
      uiDivider(), depositVaultRow(vaultOutput.address),
    ]),
    uiSection([
      uiHeading(action === 'create' ? 'Your new vault' : 'Vault before → after'),
      comparison('Collateral', beforeCollateral, afterCollateral, formatMaybeBtcVaultValue, false, ' BTC'),
      ...(transactionPrice ? [comparison('Vault value',
        beforeCollateral === undefined ? undefined : beforeCollateral / 100_000_000 * transactionPrice,
        afterCollateral / 100_000_000 * transactionPrice, formatMaybeUsd)] : []),
      comparison('UNIT debt', beforeDebt, data.unitBalanceUnit, formatMaybeUnitValue, true, ' UNIT'),
      comparison('Collateral ratio', beforeRatio, vaultHealthFromReturnData(data), formatMaybeHealth),
      ...((data.isLocked && data.tholdPrice !== undefined) || before?.liquidationPrice !== undefined
        ? [comparison('Liquidation price', before?.liquidationPrice,
          data.isLocked ? data.tholdPrice : null, (value) => value === null ? 'None' : formatMaybeUsd(value), true)] : []),
    ]),
    uiSection([
      uiHeading(entries.length === 1 ? 'Transaction' : `${entries.length} transactions`),
      ...(entries.length > 1 ? [uiRow('Total network fee', formatSatsOnly(fees))] : []),
      ...(summary.externalOutputSats > 0 ? [uiRow('External outputs', formatBtcValue(summary.externalOutputSats), 'warning')] : []),
      ...entries.map((item, index) => depositTransactionDetails(item,
        entries.length > 1 ? `${index + 1}. ${steps[index]}` : undefined)),
    ]),
    ...cosignInputsSection(signedInputs.filter((input) => input.verification === 'committed-ducat-cosign-leaf')),
    ...timeoutInputsSection(signedInputs.filter((input) => input.verification === 'committed-bitvm3-timeout-leaf')),
  ]);
}

function countCard(title: string, value: string, description: string, extra?: string): SnapElement {
  return uiCard({
    description,
    extra,
    title,
    value,
  });
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

  // Itemize every external recipient with its complete address or script identity. The PSBT and
  // batch request bounds keep this finite; the final-tree JSON guard rejects an oversized dialog.
  return externalOutputs.map((output) =>
    uiBox([
      uiRow(
        output.role === 'unknown' ? 'Unknown script' : 'To',
        detailValue(formatBtcValue(output.valueSats), outputDetailLabel(output)),
        output.role === 'unknown' ? 'warning' : undefined,
      ),
      uiCopyable(outputIdentity(output)),
    ]),
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
  network: DeploymentId;
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
    recipientOutputs.length > 0
      ? recipientOutputs.map(({ output, index }) => {
          const label = output.isMine
            ? `Change ${++changeNumber}`
            : output.role === 'unknown'
              ? `Unknown output ${index + 1}`
              : `Recipient ${++recipientNumber}`;

          return uiBox([
            uiRow(
              label,
              detailValue(formatBtcValue(output.valueSats), outputDetailLabel(output)),
              output.role === 'unknown' ? 'warning' : undefined,
            ),
            uiCopyable(outputIdentity(output)),
          ]);
        })
      : [uiMuted('No recipient or change outputs parsed. Review the totals above.')];
  const dataOutputRows = visibleDataOutputs.map(({ output, index }) =>
    uiRow(
      output.vaultData ? `Vault data #${index + 1}` : output.role === 'op_return' ? `Data #${index + 1}` : `Unknown data #${index + 1}`,
      detailValue(formatBtcValue(output.valueSats), output.vaultData ? vaultDataDetail(output.vaultData) : truncateMiddle(output.address, 24, 8)),
      output.role === 'unknown' ? 'warning' : undefined,
    ),
  );

  const deposit = vaultReview([{ summary, context }]);
  const content = deposit ? vaultConfirmation(origin, deposit) : uiBox([
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
    uiCollapsibleSection(
      `Inspect signed inputs (${summary.signedInputs.length})`,
      [...inputRows, ...(summary.signedInputs.length > visibleSignedInputs.length ? [uiMuted(`+ ${summary.signedInputs.length - visibleSignedInputs.length} more inputs`)] : [])],
    ),
    uiCollapsibleSection(`Inspect outputs (${recipientOutputs.length})`, outputRows, true),
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
  ]);

  assert_confirmation_content_fits(content);

  const confirmed = deposit
    ? await showDepositConfirmation(content, deposit.entry.summary.outputs.find((output) => output.role === 'vault' && output.isMine)!.address)
    : await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content,
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
  const statusTitle = warningCount ? 'Batch warnings' : 'Batch ready';
  const statusSeverity = warningCount ? 'warning' : 'success';
  const statusBody = warningCount
    ? `${warningCount} warning${warningCount === 1 ? '' : 's'} across this batch. Review each transaction before approving.`
    : 'Rejecting this request signs no PSBTs. Approving signs the full batch in order.';

  const deposit = vaultReview(params.entries);
  const content = deposit ? vaultConfirmation(params.origin, deposit) : uiBox([
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
      params.entries.flatMap(({ summary, context }, index) => {
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
      false,
    ),
    uiDivider(),
    uiMuted('Approve only if every transaction and recipient matches the Ducat app flow.'),
  ]);

  assert_confirmation_content_fits(content);

  const confirmed = deposit
    ? await showDepositConfirmation(content, deposit.entry.summary.outputs.find((output) => output.role === 'vault' && output.isMine)!.address)
    : await snap.request<boolean>({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content,
    },
  });

  if (!confirmed) {
    throw ducatError('USER_REJECTED', 'You rejected Ducat batch signing.');
  }
}
