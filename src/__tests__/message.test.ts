import { Buffer } from 'buffer';

import { deriveAccountSetFromBaseNodes } from '../accounts';
import { DucatKeyNode } from '../bip32';
import { signBip322SimpleMessage } from '../message';

describe('BIP322 simple message signing', () => {
  it('creates a base64 witness for the derived sats address', () => {
    const keySet = deriveAccountSetFromBaseNodes(
      'mutinynet',
      DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 5), Buffer.alloc(32, 15)),
      DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 6), Buffer.alloc(32, 16)),
    );
    const signature = signBip322SimpleMessage({
      keySet,
      role: 'sats',
      message: 'Sign in to Ducat',
    });

    expect(Buffer.from(signature, 'base64').length).toBeGreaterThan(0);
  });
});
