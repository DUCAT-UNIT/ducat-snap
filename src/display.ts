import type { DucatActionContext, DucatAddressRole, DucatNetwork } from './types';

const ACTION_LABELS: Record<string, string> = {
  borrow: 'Borrow UNIT',
  close: 'Close vault',
  create: 'Create vault',
  deposit: 'Deposit BTC',
  liquidate: 'Liquidate vault',
  liquidation: 'Liquidation',
  'liquidation-or-repossess': 'Liquidation or repossess',
  repay: 'Repay UNIT',
  repo: 'Repo vault',
  repossess: 'Repossess vault',
  'send-transfer': 'Send BTC',
  swap: 'Swap',
  transfer: 'Send BTC',
  withdraw: 'Withdraw BTC',
  'sign-batch': 'Sign Ducat batch',
  'sign-message': 'Sign Ducat message',
  'sign-psbt': 'Sign Ducat transaction',
};

const ROLE_LABELS: Record<DucatAddressRole, string> = {
  sats: 'BTC account',
  runes: 'UNIT account',
  vault: 'Vault multisig',
};

function normalizeLabelKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/gu, '-').replace(/ /gu, '-');
}

/**
 * Strip Unicode format/control/bidi characters from an app-supplied label.
 *
 * Confirmation headers (Card titles, Row labels) are rendered as plain text, so injected markdown
 * cannot create clickable links. But invisible bidi-override (U+202A-U+202E, U+2066-U+2069),
 * zero-width, and other format/control characters survive titleCaseFallback's ASCII-only cleanup
 * and let a dapp visually reorder or disguise the headline action name over a spend. We remove
 * them so the displayed label is exactly the legible characters the Snap intends to show.
 *
 * @param value - The untrusted app-supplied label text.
 * @returns The label with Unicode format/control/bidi characters removed.
 */
function stripUnsafeLabelChars(value: string): string {
  return value.replace(/[\p{Cf}\p{Cc}]/gu, '');
}

function titleCaseFallback(value: string): string {
  return stripUnsafeLabelChars(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/_/gu, ' ')
    .replace(/-/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\b\w/gu, (char: string) => char.toUpperCase());
}

export function actionLabel(context?: DucatActionContext, fallback = 'Ducat action'): string {
  const raw = context?.title ?? context?.actionType ?? context?.flow;

  if (!raw) {
    return fallback;
  }

  const key = normalizeLabelKey(raw);

  return ACTION_LABELS[key] ?? titleCaseFallback(raw);
}

/**
 * Headline for a transaction whose action the Snap could NOT verify from the PSBT (e.g. a plain
 * BTC spend with no decodable Ducat vault data). The action name there is whatever the app
 * claimed, so we must not let it occupy the primary slot as if the Snap vouched for it (SAY-02):
 * either show the Snap-derived fallback, or the app label tagged "(app-provided)" so the user
 * knows it is unverified. The truthful PSBT-derived recipients/amounts/fee are shown regardless.
 */
export function unverifiedActionLabel(context?: DucatActionContext, fallback = 'Bitcoin transaction'): string {
  const raw = context?.title ?? context?.actionType ?? context?.flow;

  if (!raw) {
    return fallback;
  }

  return `${actionLabel(context, fallback)} (app-provided)`;
}

export function roleLabel(role: DucatAddressRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : 'External account';
}

export function networkLabel(network: DucatNetwork): string {
  if (network === 'mainnet') {
    return 'Bitcoin mainnet';
  }

  return network === 'mutinynet' ? 'Mutinynet / Signet testnet' : 'Signet testnet';
}

export function originLabel(origin: string): string {
  try {
    const url = new URL(origin);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    return `${isLocalhost ? 'Local Ducat app' : 'Ducat app'} (${url.origin})`;
  } catch {
    return origin;
  }
}

export function originNameLabel(origin: string): string {
  try {
    const url = new URL(origin);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    return isLocalhost ? 'Local Ducat app' : 'Ducat app';
  } catch {
    return 'Ducat app';
  }
}

export function originUrlLabel(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
}

export function truncateMiddle(value: string, prefix = 12, suffix = 8): string {
  if (value.length <= prefix + suffix + 3) {
    return value;
  }

  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function formatBtc(sats: number): string {
  return (sats / 100_000_000).toLocaleString('en-US', {
    maximumFractionDigits: 8,
    minimumFractionDigits: 8,
  });
}

export function formatBtcValue(sats: number): string {
  return `${formatBtc(sats)} BTC`;
}

export function formatSatsOnly(sats: number): string {
  return `${formatInteger(sats)} sats`;
}

export function formatSats(sats: number, _network: DucatNetwork): string {
  return `${formatSatsOnly(sats)} (${formatBtcValue(sats)})`;
}

export function formatMaybeSats(sats: number | null, network: DucatNetwork): string {
  return sats === null ? 'Unavailable' : formatSats(sats, network);
}

export function formatMaybeBtcValue(sats: number | null): string {
  return sats === null ? 'Unavailable' : formatBtcValue(sats);
}

export function formatUnit(unit: number | null): string {
  if (unit === null) {
    return 'Unavailable';
  }

  return `${unit.toLocaleString('en-US', { maximumFractionDigits: 2 })} UNIT`;
}

export function formatMetadataKey(key: string): string {
  return titleCaseFallback(key);
}

/**
 * Neutralize MetaMask markdown syntax in app-supplied strings so they render as literal text.
 *
 * MetaMask's Text component interprets its string children as markdown, which would let an app
 * inject clickable links or emphasis (e.g. a fake "Verified" link) into the confirmation dialog.
 * We escape the characters markdown uses for links, emphasis, and code so values display verbatim.
 *
 * @param value - The untrusted app-supplied string.
 * @returns The same string with markdown control characters escaped.
 */
export function sanitizeMarkdown(value: string): string {
  return value.replace(/[\\`*_~[\]()<>|]/gu, (char) => `\\${char}`);
}

export function compactMetadataLines(context?: DucatActionContext): string[] {
  if (!context?.metadata) {
    return [];
  }

  return Object.entries(context.metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `**${formatMetadataKey(key)}:** ${sanitizeMarkdown(String(value).slice(0, 140))}`)
    .slice(0, 8);
}
