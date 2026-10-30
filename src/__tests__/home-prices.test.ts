import { homeAssetUsd, homeBitcoinPrice, homeBtcUsd, homeEthereumPrice, homeUnitTotal, homeUsd } from '../home-prices';

describe('Home display-only USD estimates', () => {
  it('rejects unavailable, stale, future and malformed quotes', async () => {
    const now = 1_800_000_000_000;
    for (const quote of [{ USD: 90_000, time: now / 1000 - 3600 }, { USD: 90_000, time: now / 1000 + 3600 }, { USD: '90000', time: now / 1000 }, { USD: -1, time: now / 1000 }]) {
      const fetchQuote = jest.fn(async () => Response.json(quote)) as typeof fetch;
      expect(await homeBitcoinPrice(fetchQuote, now)).toBeNull();
    }
    expect(await homeBitcoinPrice(jest.fn(async () => { throw new Error('offline'); }) as typeof fetch, now)).toBeNull();
  });

  it('accepts a fresh quote and caches it for at most a minute', async () => {
    const now = 1_800_000_000_000;
    const fetchQuote = jest.fn(async () => Response.json({ USD: 90_000, time: now / 1000 }));
    expect(await homeBitcoinPrice(fetchQuote as typeof fetch, now)).toBe(9_000_000n);
    expect(await homeBitcoinPrice(fetchQuote as typeof fetch, now + 30_000)).toBe(9_000_000n);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    await homeBitcoinPrice(fetchQuote as typeof fetch, now + 61_000);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
  });

  it('uses exact base units and includes restricted holdings only in the total', () => {
    expect(homeUsd(homeBtcUsd('1065757', 9_000_000n))).toBe('$959.18');
    expect(homeUsd(homeUnitTotal(['1927', '50', '100', '25']))).toBe('$21.02');
    expect(homeUsd(homeBtcUsd(null, 9_000_000n))).toBe('—');
    expect(homeUnitTotal(['1927', null])).toBeNull();
    expect(homeUsd(900719925474099312345n)).toBe('$9,007,199,254,740,993,123.45');
    expect(homeAssetUsd('184323000000000000', 18, 234925n)).toBe(43302n);
    expect(homeAssetUsd('3154583', 6, 100n)).toBe(315n);
    expect(homeAssetUsd('5050000', 6, 100n)).toBe(505n);
    expect(homeAssetUsd(null, 6, 100n)).toBeNull();
    expect(homeAssetUsd('1', 18, null)).toBeNull();
  });

  it('rejects invalid ETH quotes and rounds valid prices to cents with a one-minute cache', async () => {
    const now = 1_800_000_000_000;
    for (const data of [{ base: 'BTC', currency: 'USD', amount: '2000' }, { base: 'ETH', currency: 'EUR', amount: '2000' }, { base: 'ETH', currency: 'USD', amount: '-1' }, null]) {
      expect(await homeEthereumPrice(jest.fn(async () => Response.json({ data })) as typeof fetch, now)).toBeNull();
    }
    const fetchQuote = jest.fn(async () => Response.json({ data: { base: 'ETH', currency: 'USD', amount: '2257.395' } }));
    expect(await homeEthereumPrice(fetchQuote as typeof fetch, now)).toBe(225740n);
    expect(await homeEthereumPrice(fetchQuote as typeof fetch, now + 30000)).toBe(225740n);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    await homeEthereumPrice(fetchQuote as typeof fetch, now + 61000);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
  });
});
