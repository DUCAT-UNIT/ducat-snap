import { homeEthereumAddress } from '../home-ethereum';

const address = '0x1234567890123456789012345678901234567890';
const request = jest.fn();
beforeEach(() => {
  request.mockReset();
  (globalThis as any).ethereum = { request };
});
afterEach(() => { delete (globalThis as any).ethereum; });

test('reads the first permitted account without prompting and refreshes it on each read', async () => {
  request.mockResolvedValueOnce([address]).mockResolvedValueOnce(['0x' + 'ab'.repeat(20)]);
  expect(await homeEthereumAddress()).toBe(address);
  expect(await homeEthereumAddress()).toBe('0x' + 'ab'.repeat(20));
  expect(request.mock.calls).toEqual([[{ method: 'eth_accounts' }], [{ method: 'eth_accounts' }]]);
});

test('returns unavailable if the passive account read stalls, without opening a permission prompt', async () => {
  const controller = new AbortController();
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  request.mockImplementation(() => new Promise(() => {}));
  try {
    const reading = homeEthereumAddress(true);
    controller.abort();
    await expect(reading).resolves.toBeNull();
    expect(request.mock.calls).toEqual([[{ method: 'eth_accounts' }]]);
  } finally {
    timeout.mockRestore();
  }
});

test('reuses existing account permission even when selecting Connect ETH', async () => {
  request.mockResolvedValue([address]);
  expect(await homeEthereumAddress(true)).toBe(address);
  expect(request.mock.calls).toEqual([[{ method: 'eth_accounts' }]]);
});

test('requests missing account access on an explicit connection request', async () => {
  request.mockResolvedValueOnce([]).mockResolvedValueOnce([address]);
  expect(await homeEthereumAddress(true)).toBe(address);
  expect(request.mock.calls).toEqual([[{ method: 'eth_accounts' }], [{ method: 'eth_requestAccounts' }]]);
});

test.each([[], null, ['bad address'], address])('does not display invalid or missing accounts (%p)', async result => {
  request.mockResolvedValue(result);
  expect(await homeEthereumAddress()).toBeNull();
});

test('handles revoked access, a declined connection, and an unavailable provider', async () => {
  request.mockResolvedValueOnce([]).mockRejectedValueOnce({ code: 4001 }).mockResolvedValueOnce([]);
  expect(await homeEthereumAddress(true)).toBeNull();
  expect(await homeEthereumAddress()).toBeNull();
  delete (globalThis as any).ethereum;
  expect(await homeEthereumAddress()).toBeNull();
});
