/** Display-only USD estimates. Never used by signing or endpoint policy. */
let cachedQuote: { cents: bigint; validUntil: number } | undefined;
let cachedEthQuote: { cents: bigint; validUntil: number } | undefined;

export async function homeEthereumPrice(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<bigint | null> {
  if (cachedEthQuote && now < cachedEthQuote.validUntil) return cachedEthQuote.cents;
  try {
    const response = await fetchImpl('https://api.coinbase.com/v2/prices/ETH-USD/spot', { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!response.ok) return null;
    const quote = await response.json() as { data?: { base?: unknown; currency?: unknown; amount?: unknown } };
    if (quote?.data?.base !== 'ETH' || quote.data.currency !== 'USD' || typeof quote.data.amount !== 'string' || !/^\d{1,8}(?:\.\d{1,8})?$/u.test(quote.data.amount)) return null;
    const [whole, fraction = ''] = quote.data.amount.split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(3, '0').slice(0, 2)) + (Number(fraction[2] ?? 0) >= 5 ? 1n : 0n);
    if (cents <= 0n) return null;
    cachedEthQuote = { cents, validUntil: now + 60_000 };
    return cents;
  } catch { return null; }
}

export function homeAssetUsd(value: string | null, decimals: number, quoteCents: bigint | null): bigint | null {
  if (value === null || quoteCents === null) return null;
  const scale = 10n ** BigInt(decimals);
  return (BigInt(value) * quoteCents + scale / 2n) / scale;
}

export async function homeBitcoinPrice(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<bigint | null> {
  if (cachedQuote && now < cachedQuote.validUntil) return cachedQuote.cents;
  try {
    const response = await fetchImpl('https://mempool.space/api/v1/prices', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const quote: unknown = await response.json();
    if (!quote || typeof quote !== 'object' || !('USD' in quote) || !('time' in quote)) return null;
    const price = quote.USD;
    const timestamp = quote.time;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(Math.round(price * 100))) return null;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || now - timestamp * 1000 > 20 * 60_000 || timestamp * 1000 - now > 60_000) return null;
    const cents = BigInt(Math.round(price * 100));
    cachedQuote = { cents, validUntil: Math.min(now + 60_000, timestamp * 1000 + 20 * 60_000) };
    return cents;
  } catch { return null; }
}

export function homeUsd(cents: bigint | null): string {
  if (cents === null) return '—';
  const digits = cents.toString().padStart(3, '0');
  return `$${digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${digits.slice(-2)}`;
}

export function homeBtcUsd(sats: string | null, quoteCents: bigint | null): bigint | null {
  return sats === null || quoteCents === null ? null : (BigInt(sats) * quoteCents + 50_000_000n) / 100_000_000n;
}

export function homeUnitTotal(values: (string | null)[]): bigint | null {
  return values.some(value => value === null) ? null : values.reduce<bigint>((sum, value) => sum + BigInt(value!), 0n);
}
