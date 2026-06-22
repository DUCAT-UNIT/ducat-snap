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

// Build-time gate for the dev-only `regtest` network. mm-snap/webpack inlines
// `DUCAT_SNAP_DEV_REGTEST` as a string literal (snap.config.ts defaults it to 'false'),
// so the published/audited mainnet build resolves this to a static `false`: `regtest`
// is absent from the supported-network list, `normalizeNetwork('regtest')` is rejected as
// an unknown network, and the `http://localhost` regtest endpoints below dead-code-
// eliminate from the bundle. A separate, unpublished dev build enables it explicitly:
//   DUCAT_SNAP_DEV_REGTEST=true mm-snap build
export const DEV_REGTEST_ENABLED = process.env.DUCAT_SNAP_DEV_REGTEST === 'true';

const BASE_SUPPORTED_NETWORKS = ['mainnet', 'signet', 'mutinynet'] as const satisfies readonly DucatNetwork[];

export const DUCAT_SUPPORTED_NETWORKS: readonly DucatNetwork[] = DEV_REGTEST_ENABLED
  ? [...BASE_SUPPORTED_NETWORKS, 'regtest']
  : BASE_SUPPORTED_NETWORKS;

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
  // BitVM own-quorum FROST group key (2-of-2) for the DUCAT•FROST•UNIT Mutinynet deploy,
  // alongside the dev-fleet guardian key.
  mutinynet: [
    'ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e',
    '23586495140999e70ca54ee8cf016c3163fc929bc18057b004b502d73c632321',
  ],
  // Dev-only: the local regtest stack runs an ephemeral guardian, so the guard key
  // is NOT pinned (the Snap still signs the 2-of-2 cosign leaf but surfaces the
  // cosigner key in the confirmation dialog for the user to verify). Gated behind
  // DEV_REGTEST_ENABLED so the published build neither exposes an unpinned-guardian
  // network nor can reach it (normalizeNetwork rejects `regtest` there).
  ...(DEV_REGTEST_ENABLED ? { regtest: [] } : {}),
} as Record<DucatNetwork, readonly string[]>;

export function isKnownGuardianPubkey(network: DucatNetwork, guardPubkeyHex: string): boolean {
  const guardians = DUCAT_GUARDIAN_PUBKEYS[network] ?? [];

  return guardians.length === 0 || guardians.includes(guardPubkeyHex.toLowerCase());
}

export function guardianAllowlistEnforced(network: DucatNetwork): boolean {
  return (DUCAT_GUARDIAN_PUBKEYS[network]?.length ?? 0) > 0;
}

const ESPLORA_ENDPOINTS: Record<DucatNetwork, string> = {
  mainnet: 'https://mempool.space/api',
  signet: 'https://mempool.space/signet/api',
  mutinynet: 'https://mutinynet.com/api',
  // Dev-only: local DUCAT regtest stack electrs esplora API. The `http://localhost`
  // literal dead-code-eliminates from the published build (DEV_REGTEST_ENABLED is a
  // static `false` there).
  ...(DEV_REGTEST_ENABLED ? { regtest: 'http://localhost:3002' } : {}),
} as Record<DucatNetwork, string>;

const VALIDATOR_ENDPOINTS: Record<DucatNetwork, string[]> = {
  mainnet: ['https://validator-mainnet.prod.ducatprotocol.com'],
  signet: ['https://validator-testnet4.dev.ducatprotocol.com'],
  mutinynet: ['https://validator-mutinynet.dev.ducatprotocol.com'],
  // Dev-only: local DUCAT regtest stack validator API. Same DCE gate as above.
  ...(DEV_REGTEST_ENABLED ? { regtest: ['http://localhost:8083'] } : {}),
} as Record<DucatNetwork, string[]>;

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

  // `regtest` is dev-only: in the published build DEV_REGTEST_ENABLED is a static
  // `false`, so this branch dead-code-eliminates and `regtest` falls through to the
  // INVALID_NETWORK throw — the unpinned-guardian regtest path is unreachable there.
  if (DEV_REGTEST_ENABLED && network === 'regtest') {
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

export function bitcoinNetwork(network: DucatNetwork): Network {
  if (network === 'mainnet') {
    return networks.bitcoin;
  }

  // regtest uses the `bcrt` HRP; signet/mutinynet share the testnet params.
  return network === 'regtest' ? networks.regtest : networks.testnet;
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
