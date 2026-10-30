/** Native Snap controls shared by Home and Settings. */
import { Button, Icon, Image } from '@metamask/snaps-sdk/jsx';
import { uiBox, uiText, type SnapElement } from './ui';

type HomeIcon = 'setting' | 'close' | 'edit' | 'copy' | 'check' | 'arrow-down' | 'arrow-up';

export function homeIconButton(name: string, icon: HomeIcon, type: 'button' | 'submit' = 'button'): SnapElement {
  return Button({ name, type, size: 'sm', children: Icon({ name: icon, color: 'default', size: 'md' }) });
}

export function homeSettingTitle(label: string, name: string, editing = false): SnapElement {
  return uiBox([
    uiText(label, { color: 'alternative' }),
    homeIconButton(name, editing ? 'close' : 'edit'),
  ], { direction: 'horizontal', crossAlignment: 'center', ...(editing ? { alignment: 'space-between' } : {}) });
}

export function homeVerticalDivider(height = 44): SnapElement {
  return Image({ src: `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${height}" viewBox="0 0 1 ${height}"><path d="M.5 0V${height}" stroke="#85858d"/></svg>`, alt: '', width: 1, height });
}

/** Format integer base units without losing precision through Number. */
export function homeAmount(value: string | null, decimals: number, symbol: string, maxFractionDigits = decimals): string {
  if (value === null || !/^\d+$/u.test(value)) return 'Unavailable';
  const digits = BigInt(value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const fractional = digits.slice(-decimals).slice(0, maxFractionDigits).replace(/0+$/u, '');
  if (BigInt(value) > 0n && BigInt(digits.slice(0, -decimals)) === 0n && !fractional) {
    return `<0.${'0'.repeat(maxFractionDigits - 1)}1 ${symbol}`;
  }
  return `${whole}${fractional ? `.${fractional}` : ''} ${symbol}`;
}
