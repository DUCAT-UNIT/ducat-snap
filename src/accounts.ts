import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { initEccLib, payments } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { DucatKeyNode } from './bip32';
import { bitcoinNetwork, normalizeNetwork } from './networks';
import type { DucatAddressRole, DucatNetwork, WalletAccountRecord } from './types';

initEccLib(ecc);

export const SATS_BASE_PATHS: Record<DucatNetwork, string[]> = {
  mainnet: ['m', "84'", "0'"],
  signet: ['m', "84'", "1'"],
  mutinynet: ['m', "84'", "1'"],
};
export const TAPROOT_BASE_PATHS: Record<DucatNetwork, string[]> = {
  mainnet: ['m', "86'", "0'"],
  signet: ['m', "86'", "1'"],
  mutinynet: ['m', "86'", "1'"],
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

  if (record.runes.address === record.vault.address || record.runes.pubkey === record.vault.pubkey) {
    throw new Error('runes and vault accounts must use distinct Taproot keys.');
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

export async function getAccountKeySet(networkInput: unknown): Promise<AccountKeySet> {
  const network = normalizeNetwork(networkInput);
  const satsBaseNode = await getBip32BaseNode(SATS_BASE_PATHS[network]);
  const taprootBaseNode = await getBip32BaseNode(TAPROOT_BASE_PATHS[network]);

  return deriveAccountSetFromBaseNodes(network, satsBaseNode, taprootBaseNode);
}

export function getRoleForAddress(keySet: AccountPublicSet, address: string): DucatAddressRole | null {
  if (address === keySet.record.sats.address) {
    return 'sats';
  }

  if (address === keySet.record.runes.address) {
    return 'runes';
  }

  if (address === keySet.record.vault.address) {
    return 'vault';
  }

  return null;
}

export function getOutputScriptForRole(keySet: AccountPublicSet, role: DucatAddressRole): Buffer {
  if (role === 'sats') {
    return keySet.satsOutputScript;
  }

  return role === 'runes' ? keySet.runesOutputScript : keySet.vaultOutputScript;
}

export function getInternalPubkeyForRole(keySet: AccountPublicSet, role: Exclude<DucatAddressRole, 'sats'>): Buffer {
  return role === 'runes' ? keySet.runesInternalPubkey : keySet.vaultInternalPubkey;
}

export function getNodeForRole(keySet: AccountKeySet, role: DucatAddressRole): DucatKeyNode {
  if (role === 'sats') {
    return keySet.satsNode;
  }

  return role === 'runes' ? keySet.runesNode : keySet.vaultNode;
}
