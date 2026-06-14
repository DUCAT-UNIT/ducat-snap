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

function titleCaseFallback(value: string): string {
  return value
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

export function roleLabel(role: DucatAddressRole | null | undefined): string {
  return role ? ROLE_LABELS[role] : 'External account';
}

export function networkLabel(network: DucatNetwork): string {
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

export function compactMetadataLines(context?: DucatActionContext): string[] {
  if (!context?.metadata) {
    return [];
  }

  return Object.entries(context.metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `**${formatMetadataKey(key)}:** ${String(value).slice(0, 140)}`)
    .slice(0, 8);
}
