/** Public, display-only EVM balances. Never used by Bitcoin signing policy. */
import type { DeploymentId } from './types';

// Sepolia addresses match Ducat app/constants/evm.ts; USDC mainnet is Circle's deployment.
const PROFILES = {
  mutinynet: {
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com', chainId: 11155111n,
    wunit: '0x139a26fec4786c83888bB2b25E39f656371ed307',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  mainnet: {
    rpc: 'https://ethereum-rpc.publicnode.com', chainId: 1n,
    wunit: null,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
} as const;

export type HomeEvmBalances = {
  ethWei: string | null;
  wunit: string | null;
  usdc: string | null;
  wunitConfigured: boolean;
};

const cache = new Map<string, { validUntil: number; balances: HomeEvmBalances }>();
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const uint = (value: unknown): bigint | null => typeof value === 'string' && /^0x[\da-f]{1,64}$/iu.test(value) ? BigInt(value) : null;
const word = (value: unknown): bigint | null => typeof value === 'string' && /^0x[\da-f]{64}$/iu.test(value) ? BigInt(value) : null;

export async function homeEvmBalances(network: DeploymentId, address: string | null, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<HomeEvmBalances> {
  const profile = network === 'regtest' ? null : PROFILES[network];
  const empty: HomeEvmBalances = { ethWei: null, wunit: null, usdc: null, wunitConfigured: Boolean(profile?.wunit) };
  if (!profile || !address || !/^0x[\da-f]{40}$/iu.test(address)) return empty;
  const key = `${network}:${address.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && now < cached.validUntil) return cached.balances;
  const balanceData = `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}`;
  const tokenCall = (id: string, to: string, data: string) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to, data }, 'latest'] });
  const requests = [
    { jsonrpc: '2.0', id: 'chain', method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 'eth', method: 'eth_getBalance', params: [address, 'latest'] },
    tokenCall('usdc', profile.usdc, balanceData), tokenCall('usdc-decimals', profile.usdc, '0x313ce567'),
    ...(profile.wunit ? [tokenCall('wunit', profile.wunit, balanceData), tokenCall('wunit-decimals', profile.wunit, '0x313ce567')] : []),
  ];
  try {
    const response = await fetchImpl(profile.rpc, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requests), signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return empty;
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return empty;
    const results = new Map<string, unknown>();
    for (const item of body) {
      if (!isRecord(item) || typeof item.id !== 'string' || item.jsonrpc !== '2.0') return empty;
      if (results.has(item.id)) return empty;
      results.set(item.id, item.error ? null : item.result);
    }
    if (uint(results.get('chain')) !== profile.chainId) return empty;
    const tokenBalance = (symbol: string) => word(results.get(`${symbol}-decimals`)) === 6n ? word(results.get(symbol))?.toString() ?? null : null;
    const balances = {
      ethWei: uint(results.get('eth'))?.toString() ?? null,
      wunit: profile.wunit ? tokenBalance('wunit') : null,
      usdc: tokenBalance('usdc'), wunitConfigured: Boolean(profile.wunit),
    };
    // Keep disclosures responsive without reusing one account/network's balances for another.
    if (balances.ethWei !== null && balances.usdc !== null && (!profile.wunit || balances.wunit !== null)) {
      if (cache.size >= 8) cache.clear();
      cache.set(key, { balances, validUntil: now + 15_000 });
    }
    return balances;
  } catch { return empty; }
}
