/** Read MetaMask's most recently selected permitted account. Request missing access only after the user selects Connect ETH. */
export async function homeEthereumAddress(requestIfMissing = false): Promise<string | null> {
  try {
    if (typeof ethereum === 'undefined') return null;
    // A locked or busy provider can leave a passive read pending indefinitely.
    const deadline = AbortSignal.timeout(2_500);
    const unavailable = new Promise<null>((resolve) => {
      deadline.addEventListener('abort', () => resolve(null), { once: true });
    });
    let accounts = await Promise.race([ethereum.request({ method: 'eth_accounts' }), unavailable]);
    if (requestIfMissing && Array.isArray(accounts) && accounts.length === 0) {
      accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    }
    const address = Array.isArray(accounts) ? accounts[0] : null;
    return typeof address === 'string' && /^0x[0-9a-f]{40}$/iu.test(address) ? address : null;
  } catch {
    // Locked wallets, declined access and provider failures must not hide BTC or UNIT.
    return null;
  }
}
