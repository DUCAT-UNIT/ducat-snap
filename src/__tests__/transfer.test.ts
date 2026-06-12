import { selectUtxos } from '../transfer';

describe('transfer UTXO selection', () => {
  it('selects enough UTXOs and returns estimated fee and change', () => {
    const result = selectUtxos(
      [
        { txid: 'a', vout: 0, value: 4_000 },
        { txid: 'b', vout: 1, value: 20_000 },
        { txid: 'c', vout: 2, value: 8_000 },
      ],
      18_000,
      2,
    );

    expect(result.selected.map((utxo) => utxo.txid)).toEqual(['b']);
    expect(result.feeSats).toBe(280);
    expect(result.changeSats).toBe(1_720);
  });

  it('treats dust change as extra fee by using one output', () => {
    const result = selectUtxos([{ txid: 'dust', vout: 0, value: 10_500 }], 10_300, 1);

    expect(result.selected).toHaveLength(1);
    expect(result.feeSats).toBe(200);
    expect(result.changeSats).toBe(0);
  });

  it('rejects transfers that cannot cover amount plus fee', () => {
    expect(() => selectUtxos([{ txid: 'small', vout: 0, value: 10_000 }], 10_000, 1)).toThrow(
      'does not have enough funds',
    );
  });
});
