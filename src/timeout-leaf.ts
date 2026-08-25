/** @fileoverview Parses minimally encoded BitVM3 CSV timeout leaves and returns the committed reclaim policy. */
import { script as btcScript } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

/**
 * Recognizer for the BitVM3 unilateral-exit TIMEOUT tap-leaf:
 *
 *   `<Δ> OP_CHECKSEQUENCEVERIFY OP_DROP <operator_pk> OP_CHECKSIG`
 *
 * This is the operator's reclaim path on a bonded BitVM3 assert output (a
 * NUMS-keyed P2TR over `[disprove, timeout]`). Unlike the 2-of-2 Ducat cosign
 * leaf (see `cosign-leaf.ts`), the timeout leaf is a SINGLE-sig leaf guarded by
 * a relative timelock: only the operator key signs, and the spend is only valid
 * once the assert UTXO has aged Δ blocks (BIP-112 `OP_CSV`).
 *
 * The Snap signs this leaf ONLY when (a) the embedded operator key is the
 * derived vault pubkey and (b) the leaf is genuinely committed to the spent
 * output (the caller checks `tapLeafCommitsToOutputKey`). The recognizer's job
 * is purely to parse the leaf's fixed shape and extract the operator key + Δ;
 * it accepts the leaf shape and rejects anything else.
 *
 * Δ encoding: a minimally-encoded positive Script number in block units. Δ in 1..16 is the single
 * opcode `OP_1`..`OP_16` (0x51..0x60); Δ==0 would be `OP_0` (0x00) but a zero
 * timelock is nonsensical and rejected; larger Δ is a length-prefixed little-
 * endian push (`<len> <bytes…>`, len in 1..5). BIP-68 block delays are limited
 * to the low 16 bits; time-based, disabled, negative, and reserved-bit operands
 * are not valid BitVM3 block-timeout policies.
 */

const OP_CSV = 0xb2; // OP_CHECKSEQUENCEVERIFY
const OP_DROP = 0x75;
const OP_CHECKSIG = 0xac;
const PUSH_32 = 0x20;
const OP_1 = 0x51;
const OP_16 = 0x60;

export type TimeoutLeafMatch = {
  /** The operator x-only pubkey embedded in the leaf, lowercase hex. */
  operator: string;
  /** The relative-timelock challenge window Δ, in blocks. */
  window: number;
};

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(value)) {
    return null;
  }

  const output = new Uint8Array(value.length / 2);

  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return output;
}

/**
 * Decode the leading script-number push (Δ). Returns the decoded value and the
 * number of bytes it consumed, or null if the prefix is not a valid minimally-
 * encoded positive number push.
 */
function decodeWindow(bytes: Uint8Array): { window: number; consumed: number } | null {
  if (bytes.length === 0) {
    return null;
  }

  const opcode = bytes[0];

  // OP_1..OP_16 => 1..16 (the minimal encoding for small numbers).
  if (opcode >= OP_1 && opcode <= OP_16) {
    return { window: opcode - OP_1 + 1, consumed: 1 };
  }

  // A direct push of 1..5 bytes (BIP-112 sequence numbers are <= 5 bytes).
  if (opcode >= 1 && opcode <= 5) {
    const length = opcode;

    if (bytes.length < 1 + length) {
      return null;
    }

    let window: number;

    try {
      window = btcScript.number.decode(Buffer.from(bytes.subarray(1, 1 + length)), 5, true);
    } catch {
      return null;
    }

    if (!Number.isSafeInteger(window) || window <= 16 || window > 0xffff) {
      // <=16 should use OP_N. Values outside 1..65535 are not positive
      // block-based BIP-68 delays and may carry sign, type, disable, or reserved bits.
      return null;
    }

    return { window, consumed: 1 + length };
  }

  return null;
}

/**
 * Parses a tap-leaf hex against the BitVM3 timeout-leaf shape.
 * @param leafHex - Candidate tapscript bytes encoded as hex.
 * @returns The embedded operator key and timeout window, or null when the script does not match.
 */
export function matchTimeoutLeafHex(leafHex: string): TimeoutLeafMatch | null {
  const bytes = hexToBytes(leafHex.toLowerCase());

  if (!bytes) {
    return null;
  }

  const window = decodeWindow(bytes);

  if (!window) {
    return null;
  }

  let offset = window.consumed;

  // <Δ> OP_CSV OP_DROP
  if (bytes[offset] !== OP_CSV || bytes[offset + 1] !== OP_DROP) {
    return null;
  }
  offset += 2;

  // <32-byte pubkey>
  if (bytes[offset] !== PUSH_32) {
    return null;
  }
  offset += 1;

  if (offset + 32 > bytes.length) {
    return null;
  }

  const operatorBytes = bytes.subarray(offset, offset + 32);
  offset += 32;

  // OP_CHECKSIG, and nothing after it (no trailing script).
  if (bytes[offset] !== OP_CHECKSIG || offset + 1 !== bytes.length) {
    return null;
  }

  const operator = Array.from(operatorBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return { operator, window: window.window };
}
