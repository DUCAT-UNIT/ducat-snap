import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { bip322MessageHash, signBip322SimpleMessage } from '../message';

describe('BIP322 simple message signing', () => {
  it('creates a base64 witness and the tagged message hash for the derived sats address', () => {
    const keySet = deriveAccountSetFromBaseNodes(
      'mutinynet',
      DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 5), Buffer.alloc(32, 15)),
      DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 6), Buffer.alloc(32, 16)),
    );
    const message = 'Sign in to Ducat';
    const { signature, messageHash } = signBip322SimpleMessage({
      keySet,
      role: 'sats',
      message,
    });

    expect(Buffer.from(signature, 'base64').length).toBeGreaterThan(0);
    // messageHash must be the BIP0322 tagged digest, not an empty string (SAY-05).
    expect(messageHash).toBe(bip322MessageHash(message).toString('hex'));
    expect(messageHash).toHaveLength(64);
  });
});
