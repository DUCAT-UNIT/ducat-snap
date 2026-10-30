/** Read MetaMask's most recently selected permitted account. Home entry may request missing access. */
export async function homeEthereumAddress(requestIfMissing = false): Promise<string | null> {
  try {
    if (typeof ethereum === 'undefined') return null;
    let accounts = await ethereum.request({ method: 'eth_accounts' });
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
