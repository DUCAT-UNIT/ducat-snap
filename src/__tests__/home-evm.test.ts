import type { homeEvmBalances } from '../home-evm';

const address = '0x1234567890123456789012345678901234567890';
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`;
let balances: typeof homeEvmBalances;
beforeEach(() => {
  jest.resetModules();
  balances = jest.requireActual('../home-evm').homeEvmBalances;
});

function rpc(overrides: Record<string, unknown> = {}, errors: string[] = []) {
  const results: Record<string, unknown> = {
    chain: '0xaa36a7', eth: '0x28ed1f17b39f000',
    wunit: word(5050000n), usdc: word(3154583n),
    'wunit-decimals': word(6n), 'usdc-decimals': word(6n), ...overrides,
  };
  return jest.fn(async (_url: unknown, init?: RequestInit) => Response.json(
    JSON.parse(String(init?.body)).map((request: { id: string }) => ({
      jsonrpc: '2.0', id: request.id,
      ...(errors.includes(request.id) ? { error: { code: -32000 } } : { result: results[request.id] }),
    })).reverse(),
  ));
}

test('reads exact balances and pins calls to the selected network and approved contracts', async () => {
  const fetchRpc = rpc();
  const value = await balances('mutinynet', address, fetchRpc as typeof fetch, 1000);
  expect(value).toEqual({ ethWei: BigInt('0x28ed1f17b39f000').toString(), wunit: '5050000', usdc: '3154583', wunitConfigured: true });
  expect(fetchRpc.mock.calls[0][0]).toBe('https://ethereum-sepolia-rpc.publicnode.com');
  const requests = JSON.parse(String(fetchRpc.mock.calls[0][1]?.body));
  expect(requests.find((r: any) => r.id === 'eth').params).toEqual([address, 'latest']);
  expect(requests.find((r: any) => r.id === 'wunit').params[0]).toEqual({ to: '0x139a26fec4786c83888bB2b25E39f656371ed307', data: '0x70a08231' + address.slice(2).padStart(64, '0') });
  expect(requests.every((r: any) => ['eth_chainId', 'eth_call', 'eth_getBalance'].includes(r.method))).toBe(true);
});

test('does not query without a connected address or on an unconfigured network', async () => {
  const fetchRpc = rpc();
  await balances('mutinynet', null, fetchRpc as typeof fetch);
  await balances('mutinynet', 'invalid', fetchRpc as typeof fetch);
  await balances('regtest', address, fetchRpc as typeof fetch);
  expect(fetchRpc).not.toHaveBeenCalled();
});

test('rejects a mismatched chain instead of showing balances from another network', async () => {
  expect(await balances('mutinynet', address, rpc({ chain: '0x1' }) as typeof fetch)).toEqual({ ethWei: null, wunit: null, usdc: null, wunitConfigured: true });
});

test('preserves healthy asset balances when one token fails or has unexpected decimals', async () => {
  const value = await balances('mutinynet', address, rpc({ 'wunit-decimals': word(18n) }, ['usdc']) as typeof fetch);
  expect(value.ethWei).not.toBeNull();
  expect(value.wunit).toBeNull();
  expect(value.usdc).toBeNull();
});

test('distinguishes a true zero balance from malformed data or a failed request', async () => {
  const value = await balances('mutinynet', address, rpc({ eth: '0x0', wunit: '0x', usdc: word(0n) }) as typeof fetch);
  expect(value).toMatchObject({ ethWei: '0', wunit: null, usdc: '0' });
  const failed = await balances('mutinynet', address, jest.fn(async () => { throw new Error('offline'); }) as typeof fetch);
  expect(failed.ethWei).toBeNull();
});

test('uses Ethereum mainnet USDC and does not invent a mainnet wUNIT contract', async () => {
  const fetchRpc = rpc({ chain: '0x1' });
  expect(await balances('mainnet', address, fetchRpc as typeof fetch)).toMatchObject({ wunit: null, usdc: '3154583', wunitConfigured: false });
  expect(fetchRpc.mock.calls[0][0]).toBe('https://ethereum-rpc.publicnode.com');
  const requests = JSON.parse(String(fetchRpc.mock.calls[0][1]?.body));
  expect(requests.find((r: any) => r.id === 'usdc').params[0].to).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  expect(requests.some((r: any) => r.id === 'wunit')).toBe(false);
});

test('scopes the short cache to the account and network and expires it', async () => {
  const fetchRpc = rpc();
  await balances('mutinynet', address, fetchRpc as typeof fetch, 1000);
  await balances('mutinynet', address, fetchRpc as typeof fetch, 2000);
  expect(fetchRpc).toHaveBeenCalledTimes(1);
  await balances('mutinynet', '0x' + 'ab'.repeat(20), fetchRpc as typeof fetch, 2000);
  await balances('mainnet', address, fetchRpc as typeof fetch, 2000);
  await balances('mutinynet', address, fetchRpc as typeof fetch, 16000);
  expect(fetchRpc).toHaveBeenCalledTimes(4);
});
