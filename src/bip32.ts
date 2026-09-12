/** @fileoverview Implements private BIP32 child derivation, signing, and Taproot key tweaking for Snap key material. */
import * as ecc from '@bitcoin-js/tiny-secp256k1-asmjs';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { Buffer } from 'buffer';

const HARDENED_OFFSET = 0x80000000;

function ser32(index: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(index, 0);

  return buffer;
}

function assertPrivateKey(privateKey: Buffer): void {
  if (privateKey.length !== 32 || !ecc.isPrivate(privateKey)) {
    throw new Error('Invalid BIP32 private key.');
  }
}

function publicKeyFromPrivate(privateKey: Buffer): Buffer {
  const publicKey = ecc.pointFromScalar(privateKey, true);

  if (!publicKey) {
    throw new Error('Failed to derive public key from private key.');
  }

  return Buffer.from(publicKey);
}

export class DucatKeyNode {
  readonly privateKey: Buffer;

  readonly chainCode: Buffer;

  readonly publicKey: Buffer;

  constructor(privateKey: Buffer, chainCode: Buffer) {
    assertPrivateKey(privateKey);

    if (chainCode.length !== 32) {
      throw new Error('Invalid BIP32 chain code.');
    }

    this.privateKey = Buffer.from(privateKey);
    this.chainCode = Buffer.from(chainCode);
    this.publicKey = publicKeyFromPrivate(this.privateKey);
  }

  static fromPrivateKey(privateKey: Buffer, chainCode: Buffer): DucatKeyNode {
    return new DucatKeyNode(privateKey, chainCode);
  }

  derive(index: number): DucatKeyNode {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      throw new Error(`Invalid child index ${index}.`);
    }

    return this.deriveRaw(index, false);
  }

  deriveHardened(index: number): DucatKeyNode {
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      throw new Error(`Invalid hardened child index ${index}.`);
    }

    return this.deriveRaw(index + HARDENED_OFFSET, true);
  }

  sign(hash: Buffer): Buffer {
    return Buffer.from(ecc.sign(hash, this.privateKey));
  }

  signSchnorr(hash: Buffer): Buffer {
    return Buffer.from(ecc.signSchnorr(hash, this.privateKey));
  }

  tweak(tweak: Buffer): DucatKeyNode {
    const privateKey = this.publicKey[0] === 0x03 ? Buffer.from(ecc.privateNegate(this.privateKey)) : this.privateKey;
    const tweakedPrivateKey = ecc.privateAdd(privateKey, tweak);

    if (!tweakedPrivateKey) {
      throw new Error('Failed to tweak private key.');
    }

    return new DucatKeyNode(Buffer.from(tweakedPrivateKey), this.chainCode);
  }

  private deriveRaw(index: number, hardened: boolean): DucatKeyNode {
    const data = hardened
      ? Buffer.concat([Buffer.alloc(1), this.privateKey, ser32(index)])
      : Buffer.concat([this.publicKey, ser32(index)]);
    const digest = Buffer.from(hmac(sha512, this.chainCode, data));
    const tweak = digest.subarray(0, 32);
    const chainCode = digest.subarray(32);
    const childPrivateKey = ecc.privateAdd(this.privateKey, tweak);

    if (!childPrivateKey) {
      throw new Error('Failed to derive child private key.');
    }

    return new DucatKeyNode(Buffer.from(childPrivateKey), Buffer.from(chainCode));
  }
}
