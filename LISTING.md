# Ducat Snap Listing

## Short Description

Ducat Bitcoin accounts and Ducat-aware transaction signing in MetaMask.

## Long Description

Ducat is a MetaMask Snap for using Ducat with Bitcoin signet and mutinynet accounts derived inside MetaMask. The Snap derives deterministic testnet Bitcoin accounts from the user's MetaMask Secret Recovery Phrase, keeps private keys inside MetaMask, and signs only explicit PSBT inputs requested by the Ducat web app.

The Ducat web app remains the action surface for create, deposit, borrow, repay, withdraw, swap, liquidation, and repossess flows. The Snap provides account discovery, BIP322-style message signing, PSBT signing, batch PSBT signing, a simple transfer path, Ducat-aware MetaMask confirmations, pending/completed/failed action notifications, recent action history, and a Snap home page with copyable account addresses, BTC/UNIT balance, vault summary lookups, recent activity, and Ducat app routes.

Mainnet is intentionally not enabled in this release.

## Permissions Rationale

- `endowment:rpc`: Allows only approved Ducat frontend origins to invoke the Snap.
- `snap_getBip32Entropy`: Derives Bitcoin testnet account keys for `m/84'/1'` and `m/86'/1'`.
- `snap_dialog`: Shows mandatory confirmations before message signing, PSBT signing, batch signing, or transfers.
- `snap_manageState`: Stores recent Ducat action metadata for Snap home.
- `snap_notify`: Shows informational MetaMask notifications for pending approvals, completed actions, and failed non-rejection actions.
- `endowment:page-home`: Shows Ducat account status and Ducat app routes in MetaMask.
- `endowment:network-access`: Fetches public balance, vault, fee, UTXO, and broadcast data.
- `endowment:lifecycle-hooks`: Shows the install notice.

## Screenshot Checklist

- Install approval screen for the Ducat Snap.
- Ducat app wallet modal showing MetaMask as a connector.
- Connected Ducat account addresses.
- PSBT confirmation for create or deposit showing an action title, origin, testnet network, compact summary rows, signed input details, output details, fees, warnings, and Ducat app metadata.
- Batch confirmation for liquidation or repossess showing all-or-nothing signing, per-transaction rows, total fee, and warnings.
- Message signing confirmation showing origin, network, signing account, BIP322 signature type, message fingerprint, message length, and copyable message body.
- Transfer confirmation showing amount, fee, the `You pay` amount, change, sender, recipient, selected UTXOs, and broadcast endpoint.
- Snap home showing structured cards for accounts, BTC balance, UNIT balance, vault status, recent actions, clickable HTTPS app links, and copyable local development routes.

## Listing Asset Checklist

- Square icon: `images/icon.svg`.
- Screenshots captured from the audited build.
- Demo video following `DEMO_SCRIPT.md`.
- Privacy policy from `PRIVACY.md` or approved legal URL.
- Support and escalation contact from `SUPPORT.md`.
- Security disclosure process from `SECURITY.md`.
