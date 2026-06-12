# Screenshot Capture Guide

Capture these screenshots from the audited Snap build and place final PNG files in this directory before MetaMask submission.

Use the same Snap package, manifest shasum, frontend environment, and testnet network referenced in `../ALLOWLIST_SUBMISSION.md`.

## Required Screenshots

1. `01-install-approval.png`: MetaMask Ducat Snap install screen with permissions visible.
2. `02-wallet-selector.png`: Ducat frontend wallet selector showing MetaMask beside Xverse and UniSat.
3. `03-connected-accounts.png`: Ducat app showing the connected Snap-derived sats, runes, and vault addresses.
4. `04-psbt-confirmation.png`: Single PSBT confirmation showing action title, net spend, origin, network, fee, and collapsed details.
5. `05-batch-confirmation.png`: Liquidation or repossess batch confirmation showing all-or-nothing signing and per-transaction rows.
6. `06-message-confirmation.png`: BIP322 message confirmation with account, message length, fingerprint, and copyable message body.
7. `07-transfer-confirmation.png`: BTC transfer confirmation with recipient amount, total debit, fee, change, route, and broadcast endpoint.
8. `08-snap-home.png`: Snap Home showing accounts, balances, vault status, recent actions, app links, and local route copy fields.

## Capture Notes

- Use signet or mutinynet only.
- Do not include mainnet screens.
- Do not show private keys, seed phrases, browser profiles, or unrelated tabs.
- Prefer a clean browser profile with only MetaMask/Flask and the Ducat frontend visible.
- Re-capture all screenshots if the audited commit, package shasum, manifest shasum, or frontend Snap ID changes.
