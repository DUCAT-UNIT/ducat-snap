/** @fileoverview Enforces transport and Bitcoin-network identity for user-configured remote endpoints. */
import type { DucatNetwork } from './types';

export type EndpointKind = 'validator' | 'esplora';

const GENESIS_HASHES: Record<DucatNetwork, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  mutinynet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};

const VALIDATOR_NETWORK_NAMES: Record<DucatNetwork, readonly string[]> = {
  mainnet: ['main', 'mainnet', 'alpha-mainnet'],
  signet: ['signet'],
  mutinynet: ['mutiny', 'mutinynet'],
  testnet4: ['testnet4'],
  regtest: ['regtest'],
};

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
}

/**
 * Validates and canonicalizes an endpoint under the network transport policy.
 * @param value - Untrusted endpoint value.
 * @param field - Configuration field named in failures.
 * @param network - Network controlling whether regtest loopback HTTP is allowed.
 * @returns Credential-free canonical HTTP(S) URL without a trailing slash.
 * @throws When URL shape or transport policy is invalid.
 */
export function normalizeNetworkEndpointUrl(value: unknown, field: string, network: DucatNetwork): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be an HTTP(S) URL`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an HTTP(S) URL`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must not include credentials, a query, or a fragment`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${field} must be an HTTP(S) URL`);
  }
  if (url.protocol !== 'https:' && !(network === 'regtest' && url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error(`${field} must use HTTPS outside regtest loopback development`);
  }

  return url.toString().replace(/\/+$/u, '');
}

/**
 * Probes an endpoint and verifies its validator network or Esplora genesis before persistence.
 * @param network - Expected Ducat network.
 * @param kind - Validator or Esplora identity protocol.
 * @param endpoint - Transport-validated endpoint base URL.
 * @param fetchImpl - Injectable HTTP client.
 * @returns When the endpoint proves the expected network identity.
 * @throws On HTTP failure, malformed identity data, or network mismatch.
 */
export async function verifyNetworkEndpointIdentity(
  network: DucatNetwork,
  kind: EndpointKind,
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const path = kind === 'validator' ? '/api/proto/latest' : '/block-height/0';
  const response = await fetchImpl(`${endpoint}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`${kind} endpoint identity check failed: HTTP ${response.status}`);
  }

  if (kind === 'esplora') {
    const genesisHash = (await response.text()).trim().toLowerCase();
    if (genesisHash !== GENESIS_HASHES[network]) {
      throw new Error(`esplora endpoint is not on ${network}`);
    }
    return;
  }

  const body = await response.json();
  const chainNetwork = body && typeof body === 'object' && !Array.isArray(body) && 'chain_network' in body &&
    typeof body.chain_network === 'string'
    ? body.chain_network.toLowerCase()
    : '';
  if (!VALIDATOR_NETWORK_NAMES[network].includes(chainNetwork)) {
    throw new Error(`validator endpoint is not on ${network}`);
  }
}
