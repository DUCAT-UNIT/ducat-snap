# Privacy Policy

Last updated: 2026-06-12

The Ducat Snap derives Bitcoin accounts locally inside MetaMask using the user's MetaMask Secret Recovery Phrase. Private keys never leave MetaMask.

The Snap stores only recent Ducat action metadata needed for the Snap home page, such as action type, action title, status, network, origin, timestamp, approximate amount, summary text, and transaction IDs. The Snap also remembers the last connected Ducat app origin and network so Snap Home can show the correct testnet and Ducat app routes.

The Snap may query public Bitcoin indexer APIs and Ducat validator APIs to display balances, display vault status, estimate fees, fetch UTXOs, and broadcast transactions. Those services may receive public Bitcoin addresses, transaction identifiers, requested network, and normal request metadata such as IP address and user agent.

The Snap does not collect analytics, sell user data, or expose private keys. The Snap does not store seed phrases, private keys, or signed transaction secrets in Snap state.

Users can remove locally stored recent-action metadata by invoking the confirmed `ducat_clearRecentActions` RPC method from an approved Ducat frontend origin, or by removing the Snap from MetaMask.
