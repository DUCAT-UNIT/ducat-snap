/** The deposit destination disclosure uses the same native controls as Home. */
import { UserInputEventType, type OnUserInputHandler } from '@metamask/snaps-sdk';
import { Button, Icon, assertJSXElement } from '@metamask/snaps-sdk/jsx';
import { truncateMiddle } from './display';
import { uiBox, uiCopyable, uiText, type SnapElement } from './ui';

export const DEPOSIT_VAULT_TOGGLE = 'deposit-vault-toggle';
const ROW_KEY = 'deposit-vault-address';

export function depositVaultRow(address: string, expanded = false): SnapElement {
  const title = uiBox([
    uiText('Your vault'),
    Button({ name: DEPOSIT_VAULT_TOGGLE, type: 'button', size: 'sm', children: Icon({
      name: expanded ? 'arrow-up' : 'arrow-down', color: 'muted', size: 'md',
    }) }),
  ], { direction: 'horizontal', crossAlignment: 'center' });
  return {
    ...uiBox(expanded ? [title, uiCopyable(address)] : [
      uiBox([title, uiText(truncateMiddle(address, 10, 6))], {
        direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center',
      }),
    ]),
    key: ROW_KEY,
  };
}

/** Keep approval in MetaMask's confirmation footer; the arrow only changes presentation. */
export async function showDepositConfirmation(content: SnapElement, address: string): Promise<boolean> {
  const id = await snap.request<string>({
    method: 'snap_createInterface',
    params: { ui: content, context: {
      kind: 'deposit-confirmation', baseUi: JSON.stringify(content), address, expanded: false,
    } },
  });
  return snap.request<boolean>({ method: 'snap_dialog', params: { type: 'confirmation', id } });
}

export const handleDepositVaultInput: OnUserInputHandler = async ({ id, event, context }) => {
  if (event.type !== UserInputEventType.ButtonClickEvent || event.name !== DEPOSIT_VAULT_TOGGLE
    || context?.kind !== 'deposit-confirmation' || typeof context.baseUi !== 'string'
    || typeof context.address !== 'string' || typeof context.expanded !== 'boolean') return;
  const expanded = !context.expanded;
  const replacement = depositVaultRow(context.address, expanded);
  const ui: unknown = JSON.parse(context.baseUi, (_key, value: unknown) => {
    if (value && typeof value === 'object' && 'key' in value && value.key === ROW_KEY) return replacement;
    return value;
  });
  assertJSXElement(ui);
  await snap.request({ method: 'snap_updateInterface', params: {
    id, ui, context: { ...context, expanded },
  } });
};
