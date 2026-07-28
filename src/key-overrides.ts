/** @fileoverview Validates imported keys and resolves one derived or overridden signing keyset per network. */
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { sha256 } from '@noble/hashes/sha2';
import { Buffer } from 'buffer';

import {
  type AccountKeySet,
  getAccountKeySet,
  p2trAccount,
  p2wpkhAccount,
  toXOnly,
} from './accounts';
import { DucatKeyNode } from './bip32';
import { ducatError } from './errors';
import { normalizeNetwork } from './networks';
import { getState } from './state';
import type {
  DucatAccount,
  DucatNetwork,
  DucatSnapState,
  PrivateKeyOverrideRecord,
  PublicDucatAccountRecord,
  WalletAccountRecord,
} from './types';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HEX_KEY_PATTERN = /^(?:0x)?[0-9a-f]{64}$/iu;
const ZERO_CHAIN_CODE = Buffer.alloc(32);
let fallbackIdCounter = 0;

export type SelectedAccountKeySet = {
  id: string;
  source: 'derived' | 'imported';
  network: DucatNetwork;
  record: WalletAccountRecord;
  satsNode: DucatKeyNode;
  runesNode: DucatKeyNode;
  vaultNode: DucatKeyNode;
  taprootNode: DucatKeyNode;
  satsOutputScript: Buffer;
  runesOutputScript: Buffer;
  vaultOutputScript: Buffer;
  taprootOutputScript: Buffer;
  runesInternalPubkey: Buffer;
  vaultInternalPubkey: Buffer;
  taprootInternalPubkey: Buffer;
};

function stateWithKeyOverrides(state: DucatSnapState, keyOverrides: PrivateKeyOverrideRecord[]): DucatSnapState {
  return {
    ...state,
    keyOverrides,
  };
}

async function saveKeyOverrides(keyOverrides: PrivateKeyOverrideRecord[]): Promise<void> {
  const state = await getState();
  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: stateWithKeyOverrides(state, keyOverrides),
    },
  });
}

function id(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  fallbackIdCounter += 1;
  return `${Date.now()}-${fallbackIdCounter}`;
}

function trimHexPrefix(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
}

function base58Decode(value: string): Buffer {
  let num = 0n;

  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) {
      throw ducatError('INVALID_PARAMS', 'Imported private key is not valid WIF or 32-byte hex.');
    }
    num = num * 58n + BigInt(index);
  }

  let hex = num.toString(16);
  if (hex.length % 2) {
    hex = `0${hex}`;
  }

  const payload = hex === '00' && /^1+$/u.test(value) ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  const leadingZeroes = value.match(/^1*/u)?.[0].length ?? 0;

  return Buffer.concat([Buffer.alloc(leadingZeroes), payload]);
}

function doubleSha256(bytes: Buffer): Buffer {
  return Buffer.from(sha256(sha256(bytes)));
}

function decodeWif(value: string, network: DucatNetwork): Buffer {
  const decoded = base58Decode(value);
  if (decoded.length !== 37 && decoded.length !== 38) {
    throw ducatError('INVALID_PARAMS', 'Imported WIF private key has an invalid length.');
  }

  const body = decoded.subarray(0, -4);
  const checksum = decoded.subarray(-4);
  const expectedChecksum = doubleSha256(body).subarray(0, 4);
  if (!checksum.equals(expectedChecksum)) {
    throw ducatError('INVALID_PARAMS', 'Imported WIF private key checksum is invalid.');
  }

  const expectedVersion = network === 'mainnet' ? 0x80 : 0xef;
  if (body[0] !== expectedVersion) {
    throw ducatError('INVALID_PARAMS', 'Imported WIF private key does not match the requested network.');
  }

  if (body.length === 34 && body[33] !== 0x01) {
    throw ducatError('INVALID_PARAMS', 'Imported WIF private key has an invalid compression flag.');
  }

  return body.subarray(1, 33);
}

function privateKeyFromInput(value: unknown, network: DucatNetwork): Buffer {
  if (typeof value !== 'string' || !value.trim()) {
    throw ducatError('INVALID_PARAMS', 'Imported private key must be WIF or 32-byte hex.');
  }

  const input = value.trim();
  if (HEX_KEY_PATTERN.test(input)) {
    return Buffer.from(trimHexPrefix(input), 'hex');
  }

  return decodeWif(input, network);
}

function assertPrivateKey(privateKey: Buffer): void {
  if (privateKey.length !== 32 || !ecc.isPrivate(privateKey)) {
    throw ducatError('INVALID_PARAMS', 'Imported private key is not a valid secp256k1 private key.');
  }
}

function importedNode(privateKey: Buffer): DucatKeyNode {
  return DucatKeyNode.fromPrivateKey(privateKey, ZERO_CHAIN_CODE);
}

function makeKeyOverride(network: DucatNetwork, privateKey: Buffer): PrivateKeyOverrideRecord {
  assertPrivateKey(privateKey);
  const node = importedNode(privateKey);
  const publicKey = Buffer.from(node.publicKey);
  const runesInternalPubkey = toXOnly(publicKey);
  const sats = p2wpkhAccount(network, publicKey);
  const runes = p2trAccount(network, runesInternalPubkey);
  const fingerprint = `${network}:${runes.address}`;

  return {
    id: `imported:${network}:${id()}`,
    source: 'imported',
    network,
    created_at: Date.now(),
    fingerprint,
    private_key: privateKey.toString('hex'),
    sats: {
      address: sats.address,
      pubkey: sats.pubkey,
    },
    runes: {
      address: runes.address,
      pubkey: runes.pubkey,
    },
  };
}

function publicKeyOverride(account: PrivateKeyOverrideRecord): PublicDucatAccountRecord {
  const { private_key: _privateKey, ...publicAccount } = account;

  return publicAccount;
}

function accountNetworkFilter(network: DucatNetwork) {
  return (account: PrivateKeyOverrideRecord) => account.network === network;
}

/**
 * Selects the newest valid imported key override for one network.
 * @param keyOverrides - Sanitized persisted override records.
 * @param network - Network whose active key is requested.
 * @returns Effective override or null when derived entropy remains active.
 */
export function effectiveKeyOverride(keyOverrides: PrivateKeyOverrideRecord[], network: DucatNetwork): PrivateKeyOverrideRecord | null {
  return keyOverrides
    .filter(accountNetworkFilter(network))
    .reduce<PrivateKeyOverrideRecord | null>((latest, account) => {
      if (!latest || account.created_at >= latest.created_at) {
        return account;
      }
      return latest;
    }, null);
}

function replaceKeyOverride(keyOverrides: PrivateKeyOverrideRecord[], account: PrivateKeyOverrideRecord): PrivateKeyOverrideRecord[] {
  return [
    ...keyOverrides.filter((candidate) => candidate.network !== account.network),
    account,
  ];
}

function keyOverridesWithoutNetwork(keyOverrides: PrivateKeyOverrideRecord[], network: DucatNetwork): PrivateKeyOverrideRecord[] {
  return keyOverrides.filter((candidate) => candidate.network !== network);
}

async function prepareKeyOverride(params: {
  network: unknown;
  privateKey: unknown;
}): Promise<{
  network: DucatNetwork;
  keyOverrides: PrivateKeyOverrideRecord[];
  account: PrivateKeyOverrideRecord;
}> {
  const network = normalizeNetwork(params.network);
  const privateKey = privateKeyFromInput(params.privateKey, network);
  const state = await getState();
  const keyOverrides = state.keyOverrides ?? [];
  const account = makeKeyOverride(network, privateKey);

  return { network, keyOverrides, account };
}

async function findKeyOverrideForRemoval(params: {
  network: unknown;
  accountId: unknown;
}): Promise<{
  accountId: string;
  keyOverrides: PrivateKeyOverrideRecord[];
  account: PrivateKeyOverrideRecord;
}> {
  const network = normalizeNetwork(params.network);
  const accountId = typeof params.accountId === 'string' ? params.accountId : '';
  if (accountId.startsWith('derived:')) {
    throw ducatError('INVALID_PARAMS', 'Only an imported key override can be removed.');
  }

  const state = await getState();
  const keyOverrides = state.keyOverrides ?? [];
  const account = accountId
    ? keyOverrides.find((candidate) => candidate.network === network && candidate.id === accountId)
    : effectiveKeyOverride(keyOverrides, network);
  if (!account) {
    throw ducatError('INVALID_PARAMS', 'Imported key override was not found.', { accountId });
  }

  return { accountId: account.id, keyOverrides, account };
}

/**
 * Validates and persists a key override initiated by a trusted Snap Home interaction.
 * @param params - Network, private key, and optional label from the Home form.
 * @returns Public fields for the imported account.
 * @throws When the key or network is invalid.
 */
export async function importPrivateKeyFromSnapHome(params: {
  network: unknown;
  privateKey: unknown;
}): Promise<PublicDucatAccountRecord> {
  const { keyOverrides, account } = await prepareKeyOverride(params);
  await saveKeyOverrides(replaceKeyOverride(keyOverrides, account));

  return publicKeyOverride(account);
}

/**
 * Removes an imported override selected through Snap Home and reactivates derived entropy.
 * @param params - Network and account identity selected by the Home form.
 * @returns Removed account identity.
 * @throws When no matching imported account exists.
 */
export async function removeKeyOverrideFromSnapHome(params: {
  network: unknown;
  accountId: unknown;
}): Promise<{ removed: true; accountId: string }> {
  const { accountId, keyOverrides, account } = await findKeyOverrideForRemoval(params);
  await saveKeyOverrides(keyOverridesWithoutNetwork(keyOverrides, account.network));

  return { removed: true, accountId };
}

function overrideKeySet(account: PrivateKeyOverrideRecord): SelectedAccountKeySet {
  const network = normalizeNetwork(account.network);
  const privateKey = Buffer.from(account.private_key, 'hex');
  const node = importedNode(privateKey);
  const publicKey = Buffer.from(node.publicKey);
  const runesInternalPubkey = toXOnly(publicKey);
  const sats = p2wpkhAccount(network, publicKey);
  const runes = p2trAccount(network, runesInternalPubkey);

  return {
    id: account.id,
    source: 'imported',
    network,
    record: {
      sats: { address: sats.address, pubkey: sats.pubkey },
      runes: { address: runes.address, pubkey: runes.pubkey },
      vault: { address: runes.address, pubkey: runes.pubkey },
      authCandidates: [
        {
          address: sats.address,
          publicKey: sats.pubkey,
          addressType: 'p2wpkh',
          isPreferred: true,
        },
      ],
    },
    satsNode: node,
    runesNode: node,
    vaultNode: node,
    taprootNode: node,
    satsOutputScript: sats.output,
    runesOutputScript: runes.output,
    vaultOutputScript: runes.output,
    taprootOutputScript: runes.output,
    runesInternalPubkey,
    vaultInternalPubkey: runesInternalPubkey,
    taprootInternalPubkey: runesInternalPubkey,
  };
}

/**
 * Resolves the single active signing key set for a network.
 * An imported override is authoritative while present; otherwise Snap entropy is used.
 * @param networkInput - Untrusted network identifier.
 * @returns Active private key set plus its internal metadata.
 */
export async function getActiveAccountKeySet(networkInput: unknown): Promise<SelectedAccountKeySet> {
  const network = normalizeNetwork(networkInput);
  const state = await getState();
  const importedOverride = effectiveKeyOverride(state.keyOverrides ?? [], network);

  if (importedOverride) {
    return overrideKeySet(importedOverride);
  }

  const keySet = await getAccountKeySet(network);
  return {
    ...keySet,
    id: `derived:${network}:0`,
    source: 'derived',
    network,
  };
}
