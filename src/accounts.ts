/** @fileoverview Derives and validates network-specific BTC, UNIT, and vault accounts without exposing private nodes. */
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { initEccLib, payments } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { DucatKeyNode } from './bip32';
import { bitcoinNetwork, bitcoinNetworkForDeployment, normalizeDeploymentId } from './networks';
import type { DeploymentId, DucatAccount, DucatAddressRole, WalletAccountRecord } from './types';

initEccLib(ecc);

export const DUCAT_DERIVATION_SCHEME = 'ducat-snap/v1' as const;

type ManagedRole = 'sats' | 'runes' | 'vault';

// BIP-44/BIP-86 reserve change values 0 and 1 for external and internal
// addresses. Ducat uses change value 2 as its application-specific vault role
// branch and derives the first vault key at address index 0.
export const MANAGED_ROLE_PATHS: Record<DeploymentId, Record<ManagedRole, readonly string[]>> = {
  mainnet: {
    sats: ['m', "84'", "0'", "0'", '0', '0'],
    runes: ['m', "86'", "0'", "0'", '0', '0'],
    vault: ['m', "86'", "0'", "0'", '2', '0'],
  },
  mutinynet: {
    sats: ['m', "84'", "1'", "0'", '0', '0'],
    runes: ['m', "86'", "1'", "0'", '0', '0'],
    vault: ['m', "86'", "1'", "0'", '2', '0'],
  },
  // Regtest shares coin-type-1 key material with Mutinynet while retaining bcrt encoding.
  regtest: {
    sats: ['m', "84'", "1'", "0'", '0', '0'],
    runes: ['m', "86'", "1'", "0'", '0', '0'],
    vault: ['m', "86'", "1'", "0'", '2', '0'],
  },
};

type SnapBip32Entropy = {
  privateKey?: string;
  chainCode?: string;
};

export type AccountPublicSet = {
  network: DeploymentId;
  record: WalletAccountRecord;
  satsOutputScript: Buffer;
  runesOutputScript: Buffer;
  vaultOutputScript: Buffer;
  runesInternalPubkey: Buffer;
  vaultInternalPubkey: Buffer;
};

export type AccountKeySet = AccountPublicSet & {
  satsNode: DucatKeyNode;
  runesNode: DucatKeyNode;
  vaultNode: DucatKeyNode;
};

function trimHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function hexBuffer(label: string, hex: string, expectedBytes: number): Buffer {
  const value = trimHexPrefix(hex);

  if (!/^[0-9a-f]+$/iu.test(value) || value.length !== expectedBytes * 2) {
    throw new Error(`${label} must be a ${expectedBytes}-byte hex public key.`);
  }

  return Buffer.from(value, 'hex');
}

/** @param publicKey - Compressed or x-only secp256k1 public key. @returns Its 32-byte x-only form. */
export function toXOnly(publicKey: Buffer): Buffer {
  return publicKey.length === 32 ? publicKey : publicKey.subarray(1, 33);
}

function taprootPayment(network: DeploymentId, label: string, internalPubkey: Buffer): { address: string; output: Buffer } {
  const net = bitcoinNetwork(bitcoinNetworkForDeployment(network));
  const payment = payments.p2tr({ internalPubkey, network: net });

  if (!payment.address || !payment.output) {
    throw new Error(`Failed to derive Ducat ${label} account.`);
  }

  return { address: payment.address, output: payment.output };
}

/**
 * Derives a network-specific native-SegWit account from a compressed public key.
 * @param network - Ducat network controlling address encoding.
 * @param publicKey - Compressed secp256k1 public key.
 * @returns Public account fields and expected scriptPubKey.
 * @throws When address derivation fails.
 */
export function p2wpkhAccount(network: DeploymentId, publicKey: Buffer): DucatAccount & { output: Buffer } {
  const payment = payments.p2wpkh({ pubkey: publicKey, network: bitcoinNetwork(bitcoinNetworkForDeployment(network)) });

  if (!payment.address || !payment.output) {
    throw new Error('Failed to derive imported sats account.');
  }

  return {
    address: payment.address,
    pubkey: publicKey.toString('hex'),
    output: payment.output,
  };
}

/**
 * Derives a key-path Taproot account from an x-only internal key.
 * @param network - Ducat network controlling address encoding.
 * @param internalPubkey - Untweaked x-only internal public key.
 * @returns Public account fields and expected P2TR scriptPubKey.
 */
export function p2trAccount(network: DeploymentId, internalPubkey: Buffer): DucatAccount & { output: Buffer } {
  const payment = taprootPayment(network, 'imported', internalPubkey);

  return {
    address: payment.address,
    pubkey: internalPubkey.toString('hex'),
    output: payment.output,
  };
}

export function accountKeySetFromRoleNodes(
  network: DeploymentId,
  satsNode: DucatKeyNode,
  runesNode: DucatKeyNode,
  vaultNode: DucatKeyNode,
): AccountKeySet {
  const net = bitcoinNetwork(bitcoinNetworkForDeployment(network));
  const satsPubkey = Buffer.from(satsNode.publicKey);
  const runesInternalPubkey = toXOnly(Buffer.from(runesNode.publicKey));
  const vaultInternalPubkey = toXOnly(Buffer.from(vaultNode.publicKey));

  const satsPayment = payments.p2wpkh({ pubkey: satsPubkey, network: net });
  const runesPayment = taprootPayment(network, 'runes', runesInternalPubkey);
  const vaultPayment = taprootPayment(network, 'vault', vaultInternalPubkey);

  if (!satsPayment.address || !satsPayment.output) {
    throw new Error('Failed to derive Ducat sats account.');
  }

  const record: WalletAccountRecord = {
    sats: {
      address: satsPayment.address,
      pubkey: satsPubkey.toString('hex'),
    },
    runes: {
      address: runesPayment.address,
      pubkey: runesInternalPubkey.toString('hex'),
    },
    vault: {
      address: vaultPayment.address,
      pubkey: vaultInternalPubkey.toString('hex'),
    },
    authCandidates: [
      {
        address: satsPayment.address,
        publicKey: satsPubkey.toString('hex'),
        addressType: 'p2wpkh',
        isPreferred: true,
      },
    ],
  };

  return {
    network,
    record,
    satsNode,
    runesNode,
    vaultNode,
    satsOutputScript: satsPayment.output,
    runesOutputScript: runesPayment.output,
    vaultOutputScript: vaultPayment.output,
    runesInternalPubkey,
    vaultInternalPubkey,
  };
}

/**
 * Reconstructs scripts from persisted public keys and verifies every stored address and role split.
 * @param networkInput - Untrusted network identifier.
 * @param record - Persisted public wallet account record.
 * @returns Verified public account set with expected scripts.
 * @throws When an address does not match its corresponding public key.
 */
export function accountPublicSetFromRecord(networkInput: unknown, record: WalletAccountRecord): AccountPublicSet {
  const network = normalizeDeploymentId(networkInput);
  const net = bitcoinNetwork(bitcoinNetworkForDeployment(network));
  const satsPubkey = hexBuffer('sats.pubkey', record.sats.pubkey, 33);
  const runesInternalPubkey = hexBuffer('runes.pubkey', record.runes.pubkey, 32);
  const vaultInternalPubkey = hexBuffer('vault.pubkey', record.vault.pubkey, 32);
  const satsPayment = payments.p2wpkh({ pubkey: satsPubkey, network: net });
  const runesPayment = taprootPayment(network, 'runes', runesInternalPubkey);
  const vaultPayment = taprootPayment(network, 'vault', vaultInternalPubkey);

  if (!satsPayment.address || !satsPayment.output) {
    throw new Error('Failed to reconstruct Ducat sats account.');
  }

  if (record.sats.address !== satsPayment.address) {
    throw new Error(`sats address does not match sats.pubkey. Expected ${satsPayment.address}, got ${record.sats.address}.`);
  }

  if (record.runes.address !== runesPayment.address) {
    throw new Error(`runes address does not match runes.pubkey. Expected ${runesPayment.address}, got ${record.runes.address}.`);
  }

  if (record.vault.address !== vaultPayment.address) {
    throw new Error(`vault address does not match vault.pubkey. Expected ${vaultPayment.address}, got ${record.vault.address}.`);
  }

  return {
    network,
    record,
    satsOutputScript: satsPayment.output,
    runesOutputScript: runesPayment.output,
    vaultOutputScript: vaultPayment.output,
    runesInternalPubkey,
    vaultInternalPubkey,
  };
}

async function getBip32RoleNode(path: readonly string[]): Promise<DucatKeyNode> {
  const node = await snap.request<SnapBip32Entropy>({
    method: 'snap_getBip32Entropy',
    params: {
      path: [...path],
      curve: 'secp256k1',
    },
  });

  if (!node.privateKey || !node.chainCode) {
    throw new Error(`MetaMask did not return private entropy for ${path.join('/')}.`);
  }

  return DucatKeyNode.fromPrivateKey(Buffer.from(trimHexPrefix(node.privateKey), 'hex'), Buffer.from(trimHexPrefix(node.chainCode), 'hex'));
}

/**
 * Requests network-specific BIP32 entropy from MetaMask and derives the managed account set.
 * @param networkInput - Untrusted network identifier.
 * @returns Signing nodes retained inside the Snap plus public account metadata.
 */
export async function getAccountKeySet(networkInput: unknown): Promise<AccountKeySet> {
  const network = normalizeDeploymentId(networkInput);
  const paths = MANAGED_ROLE_PATHS[network];
  const satsNode = await getBip32RoleNode(paths.sats);
  const runesNode = await getBip32RoleNode(paths.runes);
  const vaultNode = await getBip32RoleNode(paths.vault);

  return accountKeySetFromRoleNodes(network, satsNode, runesNode, vaultNode);
}

/**
 * Classifies an address against the managed sats, runes, and vault roles.
 * @param keySet - Verified public account set.
 * @param address - Candidate Bitcoin address.
 * @returns Matching role or null when not owned.
 */
export function getRolesForAddress(keySet: AccountPublicSet, address: string): DucatAddressRole[] {
  const roles: DucatAddressRole[] = [];

  if (address === keySet.record.sats.address) {
    roles.push('sats');
  }

  if (address === keySet.record.runes.address) {
    roles.push('runes');
  }

  if (address === keySet.record.vault.address) {
    roles.push('vault');
  }

  return roles;
}

/**
 * Resolves an address to one role for APIs that do not carry input context.
 * PSBT signing must use its input-aware resolver when an address has multiple roles.
 */
export function getRoleForAddress(keySet: AccountPublicSet, address: string): DucatAddressRole | null {
  return getRolesForAddress(keySet, address)[0] ?? null;
}

/** @param keySet - Verified public account set. @param role - Managed address role. @returns Expected scriptPubKey. */
export function getOutputScriptForRole(keySet: AccountPublicSet, role: DucatAddressRole): Buffer {
  if (role === 'sats') {
    return keySet.satsOutputScript;
  }

  return role === 'runes' ? keySet.runesOutputScript : keySet.vaultOutputScript;
}

/** @param keySet - Verified public account set. @param role - Managed Taproot role. @returns X-only internal public key. */
export function getInternalPubkeyForRole(keySet: AccountPublicSet, role: Exclude<DucatAddressRole, 'sats'>): Buffer {
  return role === 'runes' ? keySet.runesInternalPubkey : keySet.vaultInternalPubkey;
}

/** @param keySet - Active private account key set. @param role - Managed address role. @returns Private signing node for that role. */
export function getNodeForRole(keySet: AccountKeySet, role: DucatAddressRole): DucatKeyNode {
  if (role === 'sats') {
    return keySet.satsNode;
  }

  return role === 'runes' ? keySet.runesNode : keySet.vaultNode;
}
