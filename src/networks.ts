/** @fileoverview Centralizes network parameters, authorized origins, guardian policy, and canonical app URLs. */
import { networks, type Network } from 'bitcoinjs-lib';

import { ducatError } from './errors';
import type { BitcoinNetwork, DeploymentId } from './types';

export const DUCAT_APP_URL = 'https://app.ducatprotocol.com';

export const DUCAT_SUPPORTED_DEPLOYMENTS = ['regtest', 'mutinynet', 'mainnet'] as const satisfies readonly DeploymentId[];

export const ALL_DEPLOYMENT_IDS = [
  'regtest',
  'mutinynet',
  'mainnet',
] as const satisfies readonly DeploymentId[];

/**
 * Normalizes only documented deployment aliases while preserving deployment identity.
 * @param deployment - Untrusted deployment identifier.
 * @returns Canonical deployment identifier.
 * @throws When the value is not a canonical deployment or documented alias.
 */
export function normalizeDeploymentId(deployment: unknown): DeploymentId {
  if (deployment === 'main') {
    return 'mainnet';
  }

  if (deployment === 'mutiny') {
    return 'mutinynet';
  }

  if (typeof deployment === 'string' && (ALL_DEPLOYMENT_IDS as readonly string[]).includes(deployment)) {
    return deployment as DeploymentId;
  }

  throw ducatError('INVALID_NETWORK', `Ducat Snap supports ${supportedNetworksSentence()} only.`, {
    requestedNetwork: deployment,
  });
}

/**
 * Maps deployment identity to Bitcoin chain mechanics without erasing the deployment identifier.
 * @param deployment - Canonical deployment identifier.
 * @returns Bitcoin network used for address, transaction, transport, and genesis mechanics.
 */
export function bitcoinNetworkForDeployment(deployment: DeploymentId): BitcoinNetwork {
  if (deployment === 'mainnet') {
    return 'mainnet';
  }

  if (deployment === 'mutinynet') {
    return 'signet';
  }

  return deployment;
}

/**
 * Known Ducat guardian (cosigner) x-only public keys, lowercase hex (64 chars), per network.
 *
 * When a network's list is non-empty, the Snap only signs a vault cosign (2-of-2) script-path
 * input whose guard key is in this list. When empty, the guard is not pinned: the Snap still
 * signs but surfaces the cosigner key in the confirmation dialog so the user can verify it.
 * Populate these with the production guardian keys to enforce the cosigner identity.
 */
// Mainnet remains fail-closed until guardian ops provisions a key that is not used by a test network.
export const DUCAT_GUARDIAN_PUBKEYS: Record<DeploymentId, readonly string[]> = {
  // Alpha issuance uses imported key-path inputs. Guardian-backed mainnet vault
  // signing stays fail-closed until a separately reviewed custody policy is available.
  mainnet: [],
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
} as Record<DeploymentId, readonly string[]>;

/**
 * Checks whether a guardian key satisfies the selected network's launch policy.
 * @param network - Ducat network.
 * @param guardPubkeyHex - Candidate x-only guardian public key.
 * @returns Whether the key is allowlisted and the network policy is ready.
 */
export function isKnownGuardianPubkey(network: DeploymentId, guardPubkeyHex: string): boolean {
  const guardians = DUCAT_GUARDIAN_PUBKEYS[network] ?? [];

  return guardianKeyPolicyReady(network) && (guardians.length === 0 || guardians.includes(guardPubkeyHex.toLowerCase()));
}

/** @param network - Ducat network. @returns Whether at least one guardian key is pinned. */
export function guardianAllowlistEnforced(network: DeploymentId): boolean {
  return (DUCAT_GUARDIAN_PUBKEYS[network]?.length ?? 0) > 0;
}

/**
 * Determines whether guardian custody configuration is launch-ready for a network.
 * @param network - Ducat network.
 * @returns False for absent keys and for mainnet keys reused by any test network.
 */
export function guardianKeyPolicyReady(network: DeploymentId): boolean {
  return network !== 'mainnet';
}

/**
 * Normalizes accepted aliases and rejects every unsupported network value.
 * @param network - Untrusted network identifier.
 * @returns Canonical Ducat network.
 * @throws When the value is not an explicitly supported network or alias.
 */
function supportedNetworksSentence(): string {
  const names = [...DUCAT_SUPPORTED_DEPLOYMENTS];

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
export function bitcoinNetwork(network: BitcoinNetwork): Network {
  if (network === 'mainnet') {
    return networks.bitcoin;
  }

  // regtest uses the `bcrt` HRP; Mutinynet uses Signet/testnet params.
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
