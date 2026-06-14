import { matchCosignLeafHex } from '../cosign-leaf';

const CLIENT = '11'.repeat(32);
const GUARD = '22'.repeat(32);
const COSIGN = `20${CLIENT}ad20${GUARD}ac`;

describe('Ducat cosign leaf matcher', () => {
  it('matches the bare Ducat 2-of-2 cosign leaf', () => {
    expect(matchCosignLeafHex(COSIGN)).toEqual({
      client: CLIENT,
      guard: GUARD,
    });
  });

  it('matches the cosign leaf with an inert ord envelope', () => {
    const envelope = '0063036f72640068';

    expect(matchCosignLeafHex(`${COSIGN}${envelope}`)).toEqual({
      client: CLIENT,
      guard: GUARD,
    });
  });

  it('rejects arbitrary trailing script after the cosign prefix', () => {
    expect(matchCosignLeafHex(`${COSIGN}51`)).toBeNull();
    expect(matchCosignLeafHex(`${COSIGN}6a`)).toBeNull();
  });

  it('rejects scripts that merely contain the client key outside the cosign shape', () => {
    expect(matchCosignLeafHex(`20${CLIENT}ac`)).toBeNull();
  });

  it('rejects a cosign leaf where the guard key equals the client key', () => {
    expect(matchCosignLeafHex(`20${CLIENT}ad20${CLIENT}ac`)).toBeNull();
  });
});
