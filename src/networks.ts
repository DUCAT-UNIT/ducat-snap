/** @fileoverview Centralizes network parameters, authorized origins, guardian policy, and canonical app URLs. */
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

// Dev-only origin allowlist. mm-snap/webpack inlines `DUCAT_SNAP_DEV_ORIGINS` as a
// string literal at build time (snap.config.ts defaults it to ''), so the
// published/audited mainnet build resolves this to an EMPTY list and never
// authorizes a localhost / non-Ducat origin. A separate, unpublished dev build
// injects local origins, e.g. for the regtest stack's frontend:
//   DUCAT_SNAP_DEV_ORIGINS=http://localhost:3000 mm-snap build
// The value is a comma-separated list of full origins (scheme + host + port).
export const DUCAT_DEV_ALLOWED_ORIGINS: readonly string[] = (process.env.DUCAT_SNAP_DEV_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const DUCAT_SUPPORTED_NETWORKS = ['regtest', 'signet', 'mutinynet', 'testnet4', 'mainnet'] as const satisfies readonly DucatNetwork[];

/**
 * Known Ducat guardian (cosigner) x-only public keys, lowercase hex (64 chars), per network.
 *
 * When a network's list is non-empty, the Snap only signs a vault cosign (2-of-2) script-path
 * input whose guard key is in this list. When empty, the guard is not pinned: the Snap still
 * signs but surfaces the cosigner key in the confirmation dialog so the user can verify it.
 * Populate these with the production guardian keys to enforce the cosigner identity.
 */
// Mainnet remains fail-closed until guardian ops provisions a key that is not used by a test network.
export const DUCAT_GUARDIAN_PUBKEYS: Record<DucatNetwork, readonly string[]> = {
  mainnet: ['ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e'],
  signet: ['ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e'],
  testnet4: ['ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e'],
  // BitVM own-quorum FROST group key (2-of-2) for the DUCAT•FROST•UNIT Mutinynet deploy,
  // alongside the dev-fleet guardian key.
  mutinynet: [
    'ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e',
    '23586495140999e70ca54ee8cf016c3163fc929bc18057b004b502d73c632321',
  ],
  // The local regtest stack runs an ephemeral guardian, so the guard key is NOT
  // pinned. The Snap still signs the 2-of-2 cosign leaf but surfaces the cosigner
  // key in the confirmation dialog for the user to verify.
  regtest: [],
} as Record<DucatNetwork, readonly string[]>;

/**
 * Checks whether a guardian key satisfies the selected network's launch policy.
 * @param network - Ducat network.
 * @param guardPubkeyHex - Candidate x-only guardian public key.
 * @returns Whether the key is allowlisted and the network policy is ready.
 */
export function isKnownGuardianPubkey(network: DucatNetwork, guardPubkeyHex: string): boolean {
  const guardians = DUCAT_GUARDIAN_PUBKEYS[network] ?? [];

  return guardianKeyPolicyReady(network) && (guardians.length === 0 || guardians.includes(guardPubkeyHex.toLowerCase()));
}

/** @param network - Ducat network. @returns Whether at least one guardian key is pinned. */
export function guardianAllowlistEnforced(network: DucatNetwork): boolean {
  return (DUCAT_GUARDIAN_PUBKEYS[network]?.length ?? 0) > 0;
}

/**
 * Determines whether guardian custody configuration is launch-ready for a network.
 * @param network - Ducat network.
 * @returns False for absent keys and for mainnet keys reused by any test network.
 */
export function guardianKeyPolicyReady(network: DucatNetwork): boolean {
  if (network !== 'mainnet') return true;

  const testKeys = new Set(
    DUCAT_SUPPORTED_NETWORKS
      .filter((candidate) => candidate !== 'mainnet')
      .flatMap((candidate) => [...DUCAT_GUARDIAN_PUBKEYS[candidate]]),
  );
  const mainnetKeys = DUCAT_GUARDIAN_PUBKEYS.mainnet;
  return mainnetKeys.length > 0 && mainnetKeys.every((key) => !testKeys.has(key));
}

/**
 * Normalizes accepted aliases and rejects every unsupported network value.
 * @param network - Untrusted network identifier.
 * @returns Canonical Ducat network.
 * @throws When the value is not an explicitly supported network or alias.
 */
export function normalizeNetwork(network: unknown): DucatNetwork {
  if (network === 'main' || network === 'mainnet' || network === 'alpha-mainnet') {
    return 'mainnet';
  }

  if (network === 'signet') {
    return 'signet';
  }

  if (network === 'testnet4') {
    return 'testnet4';
  }

  if (network === 'mutiny' || network === 'mutinynet') {
    return 'mutinynet';
  }

  if (network === 'regtest') {
    return 'regtest';
  }

  throw ducatError('INVALID_NETWORK', `Ducat Snap supports ${supportedNetworksSentence()} only.`, {
    requestedNetwork: network,
  });
}

function supportedNetworksSentence(): string {
  const names = [...DUCAT_SUPPORTED_NETWORKS];

  if (names.length <= 1) {
    return names.join('');
  }

  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * Maps a Ducat network to bitcoinjs-lib address and transaction parameters.
 * @param network - Canonical Ducat network.
 * @returns Bitcoin mainnet, testnet-family, or regtest parameters.
 */
export function bitcoinNetwork(network: DucatNetwork): Network {
  if (network === 'mainnet') {
    return networks.bitcoin;
  }

  // regtest uses the `bcrt` HRP; signet/mutinynet share the testnet params.
  return network === 'regtest' ? networks.regtest : networks.testnet;
}

/**
 * Chooses a safe HTTP(S) application origin for links shown by the Snap.
 * @param origin - Requesting origin candidate.
 * @returns Valid caller origin or the canonical Ducat application URL.
 */
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
