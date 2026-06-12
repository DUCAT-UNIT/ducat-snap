import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';

function testNode(byte: number) {
  return DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
}

describe('Ducat account derivation', () => {
  it('derives the expected testnet account shape', () => {
    const keySet = deriveAccountSetFromBaseNodes('mutinynet', testNode(1), testNode(2));

    expect(keySet.record.sats.address).toMatch(/^tb1q/);
    expect(keySet.record.runes.address).toMatch(/^tb1p/);
    expect(keySet.record.vault.address).toBe(keySet.record.runes.address);
    expect(keySet.record.sats.pubkey).toHaveLength(66);
    expect(keySet.record.runes.pubkey).toHaveLength(64);
    expect(keySet.record.authCandidates).toEqual([
      expect.objectContaining({
        address: keySet.record.sats.address,
        publicKey: keySet.record.sats.pubkey,
        addressType: 'p2wpkh',
        isPreferred: true,
      }),
    ]);
  });

  it('rejects mainnet in v1', () => {
    expect(() => deriveAccountSetFromBaseNodes('mainnet', testNode(1), testNode(2))).toThrow('supports signet and mutinynet only');
  });
});
