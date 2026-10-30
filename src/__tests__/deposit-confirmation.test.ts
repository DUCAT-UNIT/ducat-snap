import { assertJSXElement } from '@metamask/snaps-sdk/jsx';
import { UserInputEventType } from '@metamask/snaps-sdk';
import { confirmBatch, confirmPsbt } from '../confirmations';
import { DEPOSIT_VAULT_TOGGLE } from '../confirmation-vault';
import { onUserInput } from '../index';
import { truncateMiddle } from '../display';
import { VAULT_IMPROVED_COLOR, VAULT_WORSENED_COLOR } from '../vault-colors';
import { depositPreview } from './helpers/deposit-preview';

const origin = 'https://app.ducatprotocol.com';
let request: jest.Mock;
beforeEach(() => {
  request = jest.fn(async ({ method }) => method === 'snap_createInterface' ? 'deposit-interface' : true);
  (globalThis as unknown as { snap: unknown }).snap = { request };
});
function content() {
  const tree = request.mock.calls.find(([args]) => args.method === 'snap_createInterface')?.[0].params.ui
    ?? request.mock.calls.find(([args]) => args.method === 'snap_dialog')?.[0].params.content;
  assertJSXElement(tree);
  return JSON.stringify(tree);
}

function metric(label: string): string {
  const rows: unknown[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: string; props?: { label?: string } };
    if (node.type === 'Row' && node.props?.label === label) rows.push(value);
    Object.values(value).forEach(visit);
  }
  visit(JSON.parse(content()));
  expect(rows).toHaveLength(1);
  return JSON.stringify(rows[0]);
}

function vaultDisclosure(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if ('key' in value && value.key === 'deposit-vault-address') return value;
  return Object.values(value).map(vaultDisclosure).find((node) => node !== undefined);
}

it('expands the vault to one full copy field, restores the short address, and never resolves approval', async () => {
  const { summary, vault } = depositPreview();
  await confirmPsbt({ origin, summary });
  const created = request.mock.calls.find(([args]) => args.method === 'snap_createInterface')![0].params;
  expect(request).toHaveBeenCalledWith({ method: 'snap_dialog', params: { type: 'confirmation', id: 'deposit-interface' } });
  const toggle = { id: 'deposit-interface', event: { type: UserInputEventType.ButtonClickEvent as const, name: DEPOSIT_VAULT_TOGGLE } };
  request.mockClear();
  await onUserInput({ ...toggle, context: created.context });
  const update = request.mock.calls[0][0];
  expect(update.method).toBe('snap_updateInterface');
  assertJSXElement(update.params.ui);
  const vaultRow = vaultDisclosure(update.params.ui);
  expect(vaultRow).toBeDefined();
  expect(JSON.stringify(vaultRow)).toContain(vault);
  expect(JSON.stringify(vaultRow)).toContain('Copyable');
  expect(JSON.stringify(vaultRow)).not.toContain(truncateMiddle(vault, 10, 6));
  expect(update.params.context.expanded).toBe(true);
  await onUserInput({ ...toggle, context: update.params.context });
  const restored = request.mock.calls[1][0];
  assertJSXElement(restored.params.ui);
  expect(restored.params.ui).toEqual(JSON.parse(JSON.stringify(created.ui)));
  expect(request.mock.calls.map(([args]) => args.method)).toEqual(['snap_updateInterface', 'snap_updateInterface']);
});

it('ignores the disclosure control outside a deposit confirmation', async () => {
  await onUserInput({ id: 'home-interface', context: { kind: 'home' }, event: {
    type: UserInputEventType.ButtonClickEvent, name: DEPOSIT_VAULT_TOGGLE,
  } });
  expect(request).not.toHaveBeenCalled();
});

it('compares both states at the transaction price and highlights improvement only', async () => {
  const { summary } = depositPreview();
  await confirmPsbt({ origin, summary });
  expect(metric('Collateral')).toContain('0.10827400 →');
  expect(metric('Collateral')).toContain('0.11827400 BTC');
  expect(metric('Vault value')).toContain('$11,980.52 →');
  expect(metric('Vault value')).toContain('$13,087.02');
  expect(metric('Collateral ratio')).toContain('887% →');
  expect(metric('Collateral ratio')).toContain('969%');
  expect(metric('Collateral ratio')).toContain(VAULT_IMPROVED_COLOR);
  expect(metric('UNIT debt')).toContain('1,350 →');
  expect(metric('UNIT debt')).not.toContain(VAULT_IMPROVED_COLOR);
  expect(metric('Liquidation price')).toContain('$18,703.00 →');
  expect(metric('Liquidation price')).toContain('$17,122.00');
  expect(metric('Liquidation price')).toContain(VAULT_IMPROVED_COLOR);
});

it('uses verified prior debt rather than assuming debt stayed the same', async () => {
  const { summary } = depositPreview();
  summary.vaultBefore!.debtUnit = 1000;
  summary.vaultBefore!.liquidationPrice = 15000;
  await confirmPsbt({ origin, summary });
  expect(metric('UNIT debt')).toContain('1,000 →');
  expect(metric('UNIT debt')).toContain(VAULT_WORSENED_COLOR);
  expect(metric('Collateral ratio')).toContain('1,198% →');
  expect(metric('Collateral ratio')).toContain(VAULT_WORSENED_COLOR);
  expect(metric('Liquidation price')).toContain(VAULT_WORSENED_COLOR);
});

it.each(['missing', 'wrong input', 'wrong collateral'])('keeps unavailable before-state unknown (%s)', async (reason) => {
  const { summary } = depositPreview();
  if (reason === 'missing') delete summary.vaultBefore;
  else if (reason === 'wrong input') summary.vaultBefore!.inputIndex = 0;
  else summary.vaultBefore!.collateralSats++;
  await confirmPsbt({ origin, summary, context: { vault: { healthBefore: 12345, debtBeforeUnit: 500 } } });
  expect(metric('Collateral')).toContain('0.10827400 →');
  expect(metric('UNIT debt')).toContain('— →');
  expect(metric('Collateral ratio')).toContain('— →');
  expect(metric('Liquidation price')).toContain('— →');
  expect(metric('Collateral ratio')).not.toContain(VAULT_IMPROVED_COLOR);
  expect(content()).not.toContain('12,345');
});

it('shows net added collateral, real fee and resulting state without trusting app metrics', async () => {
  const { summary } = depositPreview();
  await confirmPsbt({ origin, summary, context: { actionType: 'withdraw', vault: {
    amountSats: 99_999_999, healthBefore: 12_345, liquidationPrice: 98_765,
  } } });
  const tree = content();
  expect(tree).toContain('Deposit to your vault');
  expect(tree).toContain('0.01000000 BTC');
  expect(tree).toContain('0.11827400 BTC');
  expect(tree).toContain('500 sats');
  expect(tree).toContain('1,350 UNIT');
  expect(tree).not.toContain('0.99999999 BTC');
  expect(tree).not.toContain('12,345');
  expect(tree).not.toContain('98,765');
  expect(tree).not.toContain('2-of-2');
  expect(tree).not.toContain('Healthy');
});

it('does not infer a deposit amount when some inputs are not identified', async () => {
  const { summary } = depositPreview();
  summary.signedInputs = [summary.signedInputs[0]];
  summary.signedInputIndexes = [0];
  await confirmPsbt({ origin, summary });
  expect(content()).toContain('Vault collateral after');
  expect(content()).not.toContain('You deposit');
});

it('keeps an app-labelled or unrecognized-destination deposit in the generic review', async () => {
  for (const verifiedAction of [false, true]) {
    request.mockClear();
    const { summary } = depositPreview();
    if (verifiedAction) {
      summary.vaultUpdates[0].collateralSats = undefined;
      summary.outputs[0].isMine = false;
      summary.outputs[0].role = 'external';
    } else summary.vaultUpdates = [];
    await confirmPsbt({ origin, summary, context: { actionType: 'deposit', vault: { collateralAfterSats: 99_999_999 } } });
    expect(content()).not.toContain('Deposit to your vault');
    expect(content()).toContain('Approval summary');
  }
});

it('uses the complete batch review for requests containing more than one transaction', async () => {
  const { summary, funding } = depositPreview();
  await confirmBatch({ origin, entries: [
    { summary: funding, context: { title: 'Prepare collateral' } }, { summary },
  ] });
  const tree = content();
  expect(tree).toContain('Inspect transactions (2)');
  expect(tree).toContain('0.00001000 BTC');
  expect(tree).toContain('Prepare Collateral');
  expect(tree).not.toContain('Deposit to your vault');
  expect(request).toHaveBeenCalledTimes(1);
});

it('avoids presenting a final vault state for batches containing a second vault spend', async () => {
  const { summary, funding } = depositPreview();
  funding.signedInputs[0].role = 'vault';
  await confirmBatch({ origin, entries: [{ summary }, { summary: funding }] });
  expect(content()).not.toContain('Deposit to your vault');
  expect(content()).toContain('Inspect transactions (2)');
});

it('retains every external destination, unknown script and warning in the deposit review', async () => {
  const { summary } = depositPreview();
  const recipients = Array.from({ length: 120 }, (_, i) => `external-destination-${i}`);
  summary.outputs.push(...recipients.map((address) => ({ address, scriptHex: '', valueSats: 1, isMine: false, role: 'external' as const })));
  summary.outputs.push({ address: 'Unknown script', scriptHex: '512a', valueSats: 0, isMine: false, role: 'unknown' });
  summary.outputCount = summary.outputs.length;
  summary.warnings = ['First warning', 'Second warning'];
  await confirmPsbt({ origin, summary });
  const tree = content();
  for (const address of recipients) expect(tree).toContain(address);
  expect(tree).toContain('512a');
  expect(tree).toContain('First warning');
  expect(tree).toContain('Second warning');
});

it('keeps unknown guardian and timeout signing explanations in a deposit', async () => {
  const { summary } = depositPreview();
  summary.signedInputs[0].verification = 'committed-ducat-cosign-leaf';
  summary.signedInputs[0].cosignGuardianKnown = false;
  summary.signedInputs[0].cosignGuardPubkey = 'abcd';
  summary.signedInputs[1].verification = 'committed-bitvm3-timeout-leaf';
  await confirmPsbt({ origin, summary });
  expect(content()).toContain('Not verified as a Ducat guardian');
  expect(content()).toContain('Unilateral timeout reclaim');
});

it('rejects an unpriced batch before prompting and propagates a declined deposit', async () => {
  const { summary, funding } = depositPreview();
  funding.feeSats = null;
  await expect(confirmBatch({ origin, entries: [{ summary }, { summary: funding }] }))
    .rejects.toMatchObject({ code: 'PSBT_FEE_UNAVAILABLE' });
  expect(request).not.toHaveBeenCalled();
  request.mockImplementation(async ({ method }) => method === 'snap_createInterface' ? 'deposit-interface' : false);
  await expect(confirmPsbt({ origin, summary })).rejects.toMatchObject({ code: 'USER_REJECTED' });
});
