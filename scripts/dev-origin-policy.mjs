export function parseDevelopmentOrigins(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('DUCAT_SNAP_DEV_ORIGINS must contain at least one exact development origin');
  }

  const origins = [];
  const seen = new Set();
  for (const entry of raw.split(',')) {
    const origin = entry.trim();
    if (!origin) throw new Error('DUCAT_SNAP_DEV_ORIGINS must not contain empty entries');
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`invalid development origin: ${origin}`);
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== '/'
      || url.origin !== origin
    ) {
      throw new Error(`development origin must be an exact credential-free HTTP(S) origin: ${origin}`);
    }
    if (seen.has(origin)) throw new Error(`duplicate development origin: ${origin}`);
    seen.add(origin);
    origins.push(origin);
  }
  return origins;
}
