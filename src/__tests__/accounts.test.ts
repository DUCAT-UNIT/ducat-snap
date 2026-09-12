import { Buffer } from 'buffer';

import { accountKeySetFromRoleNodes, accountPublicSetFromRecord, getRolesForAddress, MANAGED_ROLE_PATHS } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { deriveAccountSetFromBaseNodes } from './helpers/accounts';

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

  it('uses the complete role paths for Bitcoin mainnet and testnet coin types', () => {
    expect(MANAGED_ROLE_PATHS.mainnet).toEqual({
      sats: ['m', "84'", "0'", "0'", '0', '0'],
      runes: ['m', "86'", "0'", "0'", '0', '0'],
      vault: ['m', "86'", "0'", "0'", '2', '0'],
    });
    expect(MANAGED_ROLE_PATHS.mutinynet).toEqual({
      sats: ['m', "84'", "1'", "0'", '0', '0'],
      runes: ['m', "86'", "1'", "0'", '0', '0'],
      vault: ['m', "86'", "1'", "0'", '2', '0'],
    });
    expect(MANAGED_ROLE_PATHS.regtest).toEqual(MANAGED_ROLE_PATHS.mutinynet);
  });

  it.each(['mainnet', 'mutinynet'] as const)('hard-cuts the vault key to role branch 2 on %s', (network) => {
    const satsBaseNode = testNode(1);
    const taprootBaseNode = testNode(2);
    const expected = deriveAccountSetFromBaseNodes(network, satsBaseNode, taprootBaseNode);
    const oldVaultNode = taprootBaseNode.deriveHardened(0).derive(0).derive(1);
    const direct = accountKeySetFromRoleNodes(
      network,
      satsBaseNode.deriveHardened(0).derive(0).derive(0),
      taprootBaseNode.deriveHardened(0).derive(0).derive(0),
      taprootBaseNode.deriveHardened(0).derive(2).derive(0),
    );

    for (const role of ['satsNode', 'runesNode', 'vaultNode'] as const) {
      expect(direct[role].privateKey.equals(expected[role].privateKey)).toBe(true);
      expect(direct[role].chainCode.equals(expected[role].chainCode)).toBe(true);
      expect(direct[role].publicKey.equals(expected[role].publicKey)).toBe(true);
    }
    expect(direct.vaultNode.publicKey.equals(oldVaultNode.publicKey)).toBe(false);
    expect(direct.record).toEqual(expected.record);
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
    expect('satsNode' in publicSet).toBe(false);
    expect('runesNode' in publicSet).toBe(false);
    expect('vaultNode' in publicSet).toBe(false);
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
