import { networks, type Network } from 'bitcoinjs-lib';

import { ducatError } from './errors';
import type { DucatNetwork } from './types';

export const DUCAT_APP_URL = 'https://app.ducatprotocol.com';

// Only stable, org-controlled HTTPS Ducat origins are trusted to drive mainnet signing. Local
// dev (http://localhost) and ephemeral, re-registerable preview deployments (*.vercel.app) are
// deliberately excluded from the published mainnet build: a local process or a taken-over preview
// subdomain must never be an authorized signing origin. Use a separate, unpublished dev manifest
// for local development.
export const DUCAT_ALLOWED_ORIGINS = [
  'https://app.ducatprotocol.com',
  'https://dev.app.ducatprotocol.com',
  'https://staging.app.ducatprotocol.com',
] as const;

export const DUCAT_SUPPORTED_NETWORKS = ['mainnet', 'signet', 'mutinynet'] as const satisfies readonly DucatNetwork[];

/**
 * Known Ducat guardian (cosigner) x-only public keys, lowercase hex (64 chars), per network.
 *
 * When a network's list is non-empty, the Snap only signs a vault cosign (2-of-2) script-path
 * input whose guard key is in this list. When empty, the guard is not pinned: the Snap still
 * signs but surfaces the cosigner key in the confirmation dialog so the user can verify it.
 * Populate these with the production guardian keys to enforce the cosigner identity.
 */
export const DUCAT_GUARDIAN_PUBKEYS: Record<DucatNetwork, readonly string[]> = {
  mainnet: ['ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e'],
  signet: ['ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e'],
  mutinynet: ['ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e'],
};

export function isKnownGuardianPubkey(network: DucatNetwork, guardPubkeyHex: string): boolean {
  const guardians = DUCAT_GUARDIAN_PUBKEYS[network];

  return guardians.length === 0 || guardians.includes(guardPubkeyHex.toLowerCase());
}

export function guardianAllowlistEnforced(network: DucatNetwork): boolean {
  return DUCAT_GUARDIAN_PUBKEYS[network].length > 0;
}

const ESPLORA_ENDPOINTS: Record<DucatNetwork, string> = {
  mainnet: 'https://mempool.space/api',
  signet: 'https://mempool.space/signet/api',
  mutinynet: 'https://mutinynet.com/api',
};

const VALIDATOR_ENDPOINTS: Record<DucatNetwork, string[]> = {
  mainnet: ['https://validator-mainnet.prod.ducatprotocol.com'],
  signet: ['https://validator-testnet4.dev.ducatprotocol.com'],
  mutinynet: ['https://validator-mutinynet.dev.ducatprotocol.com'],
};

export function normalizeNetwork(network: unknown): DucatNetwork {
  if (network === 'main' || network === 'mainnet' || network === 'alpha-mainnet') {
    return 'mainnet';
  }

  if (network === 'signet') {
    return 'signet';
  }

  if (network === 'mutiny' || network === 'mutinynet') {
    return 'mutinynet';
  }

  throw ducatError('INVALID_NETWORK', 'Ducat Snap supports mainnet, signet, and mutinynet only.', {
    requestedNetwork: network,
  });
}

export function bitcoinNetwork(network: DucatNetwork): Network {
  return network === 'mainnet' ? networks.bitcoin : networks.testnet;
}

export function esploraUrl(network: DucatNetwork): string {
  return ESPLORA_ENDPOINTS[network];
}

export function validatorUrls(network: DucatNetwork): string[] {
  return VALIDATOR_ENDPOINTS[network];
}

export function ducatAppUrl(origin?: string): string {
  if (!origin) {
    return DUCAT_APP_URL;
  }

  try {
    const url = new URL(origin);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin;
    }
  } catch {
    return DUCAT_APP_URL;
  }

  return DUCAT_APP_URL;
}
