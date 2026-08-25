import { Buffer } from 'buffer';

import { accountPublicSetFromRecord, deriveAccountSetFromBaseNodes, getRolesForAddress, SATS_BASE_PATHS, TAPROOT_BASE_PATHS } from '../accounts';
import { DucatKeyNode } from '../bip32';

function testNode(byte: number) {
  return DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
}

describe('Ducat account derivation', () => {
  it('derives the expected testnet account shape', () => {
    const keySet = deriveAccountSetFromBaseNodes('mutinynet', testNode(1), testNode(2));

    expect(keySet.record.sats.address).toMatch(/^tb1q/);
    expect(keySet.record.runes.address).toMatch(/^tb1p/);
    expect(keySet.record.vault.address).toMatch(/^tb1p/);
    expect(keySet.record.vault.address).not.toBe(keySet.record.runes.address);
    expect(keySet.record.sats.pubkey).toHaveLength(66);
    expect(keySet.record.runes.pubkey).toHaveLength(64);
    expect(keySet.record.vault.pubkey).toHaveLength(64);
    expect(keySet.record.vault.pubkey).not.toBe(keySet.record.runes.pubkey);
    expect(keySet.record.authCandidates).toEqual([
      expect.objectContaining({
        address: keySet.record.sats.address,
        publicKey: keySet.record.sats.pubkey,
        addressType: 'p2wpkh',
        isPreferred: true,
      }),
    ]);
  });

  it('derives the expected mainnet account shape', () => {
    const keySet = deriveAccountSetFromBaseNodes('mainnet', testNode(1), testNode(2));

    expect(keySet.record.sats.address).toMatch(/^bc1q/);
    expect(keySet.record.runes.address).toMatch(/^bc1p/);
    expect(keySet.record.vault.address).toMatch(/^bc1p/);
    expect(keySet.record.vault.address).not.toBe(keySet.record.runes.address);
  });

  it('uses Bitcoin mainnet and testnet coin-type base paths', () => {
    expect(SATS_BASE_PATHS.mainnet).toEqual(['m', "84'", "0'"]);
    expect(TAPROOT_BASE_PATHS.mainnet).toEqual(['m', "86'", "0'"]);
    expect(SATS_BASE_PATHS.signet).toEqual(['m', "84'", "1'"]);
    expect(TAPROOT_BASE_PATHS.mutinynet).toEqual(['m', "86'", "1'"]);
  });

  it('reconstructs public account ownership data without private keys', () => {
    const keySet = deriveAccountSetFromBaseNodes('mutinynet', testNode(1), testNode(2));
    const publicSet = accountPublicSetFromRecord('mutinynet', keySet.record);

    expect(publicSet.record).toEqual(keySet.record);
    expect(publicSet.satsOutputScript.equals(keySet.satsOutputScript)).toBe(true);
    expect(publicSet.runesOutputScript.equals(keySet.runesOutputScript)).toBe(true);
    expect(publicSet.vaultOutputScript.equals(keySet.vaultOutputScript)).toBe(true);
    expect(publicSet.runesInternalPubkey.equals(keySet.runesInternalPubkey)).toBe(true);
    expect(publicSet.vaultInternalPubkey.equals(keySet.vaultInternalPubkey)).toBe(true);
    expect(publicSet.taprootOutputScript.equals(keySet.taprootOutputScript)).toBe(true);
    expect(publicSet.taprootInternalPubkey.equals(keySet.taprootInternalPubkey)).toBe(true);
    expect('satsNode' in publicSet).toBe(false);
    expect('runesNode' in publicSet).toBe(false);
    expect('vaultNode' in publicSet).toBe(false);
    expect('taprootNode' in publicSet).toBe(false);
  });

  it('accepts one Taproot key shared by the runes and vault roles', () => {
    const keySet = deriveAccountSetFromBaseNodes('mutinynet', testNode(1), testNode(2));
    const sharedRecord = {
      ...keySet.record,
      vault: { ...keySet.record.runes },
    };
    const publicSet = accountPublicSetFromRecord('mutinynet', sharedRecord);

    expect(publicSet.vaultInternalPubkey.equals(publicSet.runesInternalPubkey)).toBe(true);
    expect(publicSet.vaultOutputScript.equals(publicSet.runesOutputScript)).toBe(true);
    expect(getRolesForAddress(publicSet, sharedRecord.runes.address)).toEqual(['runes', 'vault']);
  });

  it('rejects account records whose addresses do not match their public keys', () => {
    const keySet = deriveAccountSetFromBaseNodes('mutinynet', testNode(1), testNode(2));

    expect(() =>
      accountPublicSetFromRecord('mutinynet', {
        ...keySet.record,
        sats: { ...keySet.record.sats, address: 'tb1qwrong' },
      }),
    ).toThrow('sats address does not match sats.pubkey');
  });
});
