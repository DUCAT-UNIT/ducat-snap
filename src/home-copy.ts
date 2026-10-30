/** Native inline disclosures for public account values. */
import { Button, Icon } from '@metamask/snaps-sdk/jsx';
import { uiBox, uiCopyable, uiText, type SnapElement } from './ui';

export type HomeCopyKind = 'btc' | 'unit' | 'eth' | 'key' | 'validator' | 'esplora';

export function homeCopyKind(name: string): HomeCopyKind | null {
  const match = /^home-toggle-copy-(btc|unit|eth|key|validator|esplora)$/u.exec(name);
  return match ? match[1] as HomeCopyKind : null;
}

/** Copyable always receives the complete value; only the collapsed text is shortened. */
export function homeCopyRow(title: SnapElement, value: string, kind: HomeCopyKind, expanded = false): SnapElement {
  const toggle = Button({
    name: `home-toggle-copy-${kind}`, type: 'button', size: 'sm',
    children: Icon({ name: expanded ? 'arrow-up' : 'arrow-down', color: 'muted', size: 'md' }),
  });
  const summary = kind === 'key' ? `${value.slice(0, 12)}…${value.slice(-10)}`
    : kind === 'btc' || kind === 'unit' || kind === 'eth' ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  if (!expanded && (kind === 'btc' || kind === 'unit' || kind === 'eth')) {
    return uiBox([
      uiBox([title, toggle], { direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center' }),
      uiText(summary),
    ]);
  }
  return uiBox(expanded ? [
    uiBox([title, toggle], { direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center' }),
    uiCopyable(value),
  ] : [
    title,
    uiBox([uiText(summary), toggle], { direction: 'horizontal', alignment: 'space-between', crossAlignment: 'center' }),
  ]);
}
