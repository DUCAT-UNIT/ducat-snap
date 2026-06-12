import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { initEccLib, payments } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { DucatKeyNode } from './bip32';
import { bitcoinNetwork, normalizeNetwork } from './networks';
import type { DucatAddressRole, DucatNetwork, WalletAccountRecord } from './types';

initEccLib(ecc);

export const SATS_BASE_PATH = ['m', "84'", "1'"];
export const TAPROOT_BASE_PATH = ['m', "86'", "1'"];

type SnapBip32Entropy = {
  privateKey?: string;
  chainCode?: string;
};

export type AccountKeySet = {
  network: DucatNetwork;
  record: WalletAccountRecord;
  satsNode: DucatKeyNode;
  taprootNode: DucatKeyNode;
  satsOutputScript: Buffer;
  taprootOutputScript: Buffer;
  taprootInternalPubkey: Buffer;
};

function trimHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function deriveAccountNode(baseNode: DucatKeyNode): DucatKeyNode {
  return baseNode.deriveHardened(0).derive(0).derive(0);
}

export function toXOnly(publicKey: Buffer): Buffer {
  return publicKey.length === 32 ? publicKey : publicKey.subarray(1, 33);
}

function accountRecordFromNodes(network: DucatNetwork, satsNode: DucatKeyNode, taprootNode: DucatKeyNode): AccountKeySet {
  const net = bitcoinNetwork(network);
  const satsPubkey = Buffer.from(satsNode.publicKey);
  const taprootPubkey = Buffer.from(taprootNode.publicKey);
  const taprootInternalPubkey = toXOnly(taprootPubkey);

  const satsPayment = payments.p2wpkh({ pubkey: satsPubkey, network: net });
  const taprootPayment = payments.p2tr({ internalPubkey: taprootInternalPubkey, network: net });

  if (!satsPayment.address || !satsPayment.output) {
    throw new Error('Failed to derive Ducat sats account.');
  }

  if (!taprootPayment.address || !taprootPayment.output) {
    throw new Error('Failed to derive Ducat taproot account.');
  }

  const record: WalletAccountRecord = {
    sats: {
      address: satsPayment.address,
      pubkey: satsPubkey.toString('hex'),
    },
    runes: {
      address: taprootPayment.address,
      pubkey: taprootInternalPubkey.toString('hex'),
    },
    vault: {
      address: taprootPayment.address,
      pubkey: taprootInternalPubkey.toString('hex'),
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
    taprootNode,
    satsOutputScript: satsPayment.output,
    taprootOutputScript: taprootPayment.output,
    taprootInternalPubkey,
  };
}

export function deriveAccountSetFromBaseNodes(
  networkInput: unknown,
  satsBaseNode: DucatKeyNode,
  taprootBaseNode: DucatKeyNode,
): AccountKeySet {
  const network = normalizeNetwork(networkInput);

  return accountRecordFromNodes(network, deriveAccountNode(satsBaseNode), deriveAccountNode(taprootBaseNode));
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
  const satsBaseNode = await getBip32BaseNode(SATS_BASE_PATH);
  const taprootBaseNode = await getBip32BaseNode(TAPROOT_BASE_PATH);

  return deriveAccountSetFromBaseNodes(network, satsBaseNode, taprootBaseNode);
}

export function getRoleForAddress(keySet: AccountKeySet, address: string): DucatAddressRole | null {
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

export function getNodeForRole(keySet: AccountKeySet, role: DucatAddressRole): DucatKeyNode {
  return role === 'sats' ? keySet.satsNode : keySet.taprootNode;
}
