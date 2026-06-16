import { matchTimeoutLeafHex } from '../timeout-leaf';

const OPERATOR = '33'.repeat(32);

// <Δ> OP_CSV(b2) OP_DROP(75) <32-byte push:20> <operator> OP_CHECKSIG(ac)
const timeoutLeaf = (windowHexPrefix: string, operator = OPERATOR): string =>
  `${windowHexPrefix}b27520${operator}ac`;

describe('BitVM3 timeout leaf matcher', () => {
  it('matches a leaf with a small Δ encoded as OP_N (OP_10 = 0x5a)', () => {
    expect(matchTimeoutLeafHex(timeoutLeaf('5a'))).toEqual({
      operator: OPERATOR,
      window: 10,
    });
  });

  it('matches Δ = 1 (OP_1 = 0x51) and Δ = 16 (OP_16 = 0x60)', () => {
    expect(matchTimeoutLeafHex(timeoutLeaf('51'))).toEqual({ operator: OPERATOR, window: 1 });
    expect(matchTimeoutLeafHex(timeoutLeaf('60'))).toEqual({ operator: OPERATOR, window: 16 });
  });

  it('matches a larger Δ that fits one byte even with the high bit set (Δ = 144 => 0190)', () => {
    // This is the encoding @vbyte/btc-dev (the client-sdk / front-end) actually
    // emits for Δ=144: a single-byte push <0x90>. Script-number sign-magnitude
    // reads 0x90 as 144 here (an unsigned 1-byte sequence). Pinning the real
    // cross-toolchain encoding so the Snap signs what the front-end builds.
    expect(matchTimeoutLeafHex(timeoutLeaf('0190'))).toEqual({
      operator: OPERATOR,
      window: 144,
    });
  });

  it('matches a 2-byte Δ with an explicit sign byte (Δ = 144 => 0x9000)', () => {
    // The canonical signed minimal form (leading 0x00 sign byte) also decodes.
    expect(matchTimeoutLeafHex(timeoutLeaf('029000'))).toEqual({
      operator: OPERATOR,
      window: 144,
    });
  });

  it('matches a larger Δ that needs no sign byte (Δ = 100 => 0x0164)', () => {
    // 100 = 0x64, high bit clear, single byte push.
    expect(matchTimeoutLeafHex(timeoutLeaf('0164'))).toEqual({
      operator: OPERATOR,
      window: 100,
    });
  });

  it('rejects a leaf with trailing script after OP_CHECKSIG', () => {
    expect(matchTimeoutLeafHex(`${timeoutLeaf('5a')}51`)).toBeNull();
  });

  it('rejects a cosign-shaped leaf (different opcodes)', () => {
    const cosign = `20${'11'.repeat(32)}ad20${'22'.repeat(32)}ac`;
    expect(matchTimeoutLeafHex(cosign)).toBeNull();
  });

  it('rejects a leaf missing OP_DROP after OP_CSV', () => {
    // <Δ> OP_CSV <pubkey> OP_CHECKSIG — no OP_DROP.
    expect(matchTimeoutLeafHex(`5ab220${OPERATOR}ac`)).toBeNull();
  });

  it('rejects a Δ = 0 (OP_0) timelock', () => {
    expect(matchTimeoutLeafHex(`00b27520${OPERATOR}ac`)).toBeNull();
  });

  it('rejects a non-minimal Δ push (Δ = 5 pushed as <0105> instead of OP_5)', () => {
    expect(matchTimeoutLeafHex(`0105b27520${OPERATOR}ac`)).toBeNull();
  });

  it('rejects a truncated pubkey push', () => {
    expect(matchTimeoutLeafHex(`5ab27520${'33'.repeat(20)}ac`)).toBeNull();
  });

  it('rejects odd-length / non-hex input', () => {
    expect(matchTimeoutLeafHex('5ab27520zz')).toBeNull();
    expect(matchTimeoutLeafHex('5ab2752')).toBeNull();
  });
});
