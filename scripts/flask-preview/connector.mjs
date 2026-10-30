export const SNAP_ID = 'local:http://localhost:8086';

export function discoverFlask(scope = window) {
  let detected;
  const remember = (event) => {
    if (event.detail?.info?.rdns === 'io.metamask.flask' && typeof event.detail?.provider?.request === 'function') detected = event.detail.provider;
  };
  scope.addEventListener('eip6963:announceProvider', remember);
  scope.dispatchEvent(new Event('eip6963:requestProvider'));
  return async () => {
    scope.dispatchEvent(new Event('eip6963:requestProvider'));
    if (detected) return detected;
    const candidates = scope.ethereum?.providers ?? (scope.ethereum ? [scope.ethereum] : []);
    for (const provider of candidates) {
      try {
        const version = await provider.request({ method: 'web3_clientVersion' });
        if (typeof version === 'string' && version.toLowerCase().includes('flask')) return provider;
      } catch { /* Try the next injected wallet. */ }
    }
    throw new Error('Open this page in the browser profile where MetaMask Flask is installed, then try again. The in-app preview browser does not provide Flask.');
  };
}

export async function connectLocalSnap(provider, fetchImpl = fetch) {
  const response = await fetchImpl('http://localhost:8086/snap.manifest.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('The local Snap build is unavailable. Restart the local preview server.');
  const manifest = await response.json();
  if (manifest.proposedName !== 'Ducat' || !manifest.initialPermissions?.['endowment:rpc']?.allowedOrigins?.includes('http://localhost:3000')) {
    throw new Error('This is not the expected Ducat development build.');
  }
  const snaps = await provider.request({ method: 'wallet_requestSnaps', params: { [SNAP_ID]: {} } });
  const installed = snaps?.[SNAP_ID];
  if (installed?.error) throw new Error(installed.error.message ?? 'Flask could not install the local Snap.');
  if (!installed || installed.enabled !== true || installed.blocked === true) {
    throw new Error('The local Ducat Snap is not enabled. Check the request in MetaMask Flask.');
  }
  return installed;
}
