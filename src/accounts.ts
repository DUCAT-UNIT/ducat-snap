/** @fileoverview Derives and validates network-specific BTC, UNIT, and vault accounts without exposing private nodes. */
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { initEccLib, payments } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { DucatKeyNode } from './bip32';
import { bitcoinNetwork, normalizeNetwork } from './networks';
import type { DucatAccount, DucatAddressRole, DucatNetwork, WalletAccountRecord } from './types';

initEccLib(ecc);

export const SATS_BASE_PATHS: Record<DucatNetwork, string[]> = {
  mainnet: ['m', "84'", "0'"],
  signet: ['m', "84'", "1'"],
  mutinynet: ['m', "84'", "1'"],
  testnet4: ['m', "84'", "1'"],
  // regtest shares the testnet coin type (1'), matching the local DUCAT stack.
  regtest: ['m', "84'", "1'"],
};
export const TAPROOT_BASE_PATHS: Record<DucatNetwork, string[]> = {
  mainnet: ['m', "86'", "0'"],
  signet: ['m', "86'", "1'"],
  mutinynet: ['m', "86'", "1'"],
  testnet4: ['m', "86'", "1'"],
  // regtest shares the testnet coin type (1') so vault keys match signet/mutinynet.
  regtest: ['m', "86'", "1'"],
};

type SnapBip32Entropy = {
  privateKey?: string;
  chainCode?: string;
};

export type AccountPublicSet = {
  network: DucatNetwork;
  record: WalletAccountRecord;
  satsOutputScript: Buffer;
  runesOutputScript: Buffer;
  vaultOutputScript: Buffer;
  runesInternalPubkey: Buffer;
  vaultInternalPubkey: Buffer;
  /** Compatibility alias for the vault Taproot account. Prefer vaultOutputScript. */
  taprootOutputScript: Buffer;
  /** Compatibility alias for the vault Taproot account. Prefer vaultInternalPubkey. */
  taprootInternalPubkey: Buffer;
};

export type AccountKeySet = AccountPublicSet & {
  satsNode: DucatKeyNode;
  runesNode: DucatKeyNode;
  vaultNode: DucatKeyNode;
  /** Compatibility alias for the vault Taproot account. Prefer vaultNode. */
  taprootNode: DucatKeyNode;
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

function deriveAccountNode(baseNode: DucatKeyNode, index = 0): DucatKeyNode {
  return baseNode.deriveHardened(0).derive(0).derive(index);
}

/** @param publicKey - Compressed or x-only secp256k1 public key. @returns Its 32-byte x-only form. */
export function toXOnly(publicKey: Buffer): Buffer {
  return publicKey.length === 32 ? publicKey : publicKey.subarray(1, 33);
}

function taprootPayment(network: DucatNetwork, label: string, internalPubkey: Buffer): { address: string; output: Buffer } {
  const net = bitcoinNetwork(network);
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
export function p2wpkhAccount(network: DucatNetwork, publicKey: Buffer): DucatAccount & { output: Buffer } {
  const payment = payments.p2wpkh({ pubkey: publicKey, network: bitcoinNetwork(network) });

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
export function p2trAccount(network: DucatNetwork, internalPubkey: Buffer): DucatAccount & { output: Buffer } {
  const payment = taprootPayment(network, 'imported', internalPubkey);

  return {
    address: payment.address,
    pubkey: internalPubkey.toString('hex'),
    output: payment.output,
  };
}

function accountRecordFromNodes(network: DucatNetwork, satsNode: DucatKeyNode, runesNode: DucatKeyNode, vaultNode: DucatKeyNode): AccountKeySet {
  const net = bitcoinNetwork(network);
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
    taprootNode: vaultNode,
    satsOutputScript: satsPayment.output,
    runesOutputScript: runesPayment.output,
    vaultOutputScript: vaultPayment.output,
    taprootOutputScript: vaultPayment.output,
    runesInternalPubkey,
    vaultInternalPubkey,
    taprootInternalPubkey: vaultInternalPubkey,
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
  const network = normalizeNetwork(networkInput);
  const net = bitcoinNetwork(network);
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
    taprootOutputScript: vaultPayment.output,
    runesInternalPubkey,
    vaultInternalPubkey,
    taprootInternalPubkey: vaultInternalPubkey,
  };
}

/**
 * Derives index-0 sats/runes keys and a distinct index-1 vault key from role base nodes.
 * @param networkInput - Untrusted network identifier.
 * @param baseNodes - BIP32 nodes isolated by managed address role.
 * @returns Private key nodes and their verified public account record.
 */
export function deriveAccountSetFromBaseNodes(
  networkInput: unknown,
  satsBaseNode: DucatKeyNode,
  taprootBaseNode: DucatKeyNode,
): AccountKeySet {
  const network = normalizeNetwork(networkInput);

  return accountRecordFromNodes(network, deriveAccountNode(satsBaseNode), deriveAccountNode(taprootBaseNode, 0), deriveAccountNode(taprootBaseNode, 1));
}

async function getBip32BaseNode(path: string[]): Promise<DucatKeyNode> {
  const node = await snap.request<SnapBip32Entropy>({
    method: 'snap_getBip32Entropy',
    params: {
      path,
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
  const network = normalizeNetwork(networkInput);
  const satsBaseNode = await getBip32BaseNode(SATS_BASE_PATHS[network]);
  const taprootBaseNode = await getBip32BaseNode(TAPROOT_BASE_PATHS[network]);

  return deriveAccountSetFromBaseNodes(network, satsBaseNode, taprootBaseNode);
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
