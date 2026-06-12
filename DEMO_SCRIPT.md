# Ducat Snap Demo Script

Use this script for the MetaMask allowlist/directory submission video. Record against the audited build and the same package version submitted to npm.

## Setup

1. Build and serve the Snap with `npm run verify` and `npm run serve`.
2. Configure the Ducat frontend with `NEXT_PUBLIC_DUCAT_SNAP_ID` pointing at the local Snap during pre-submission testing, or `npm:@ducat-unit/ducat-snap` for the npm build.
3. Use signet or mutinynet only.
4. Fund the Snap-derived sats account with test BTC.

## Recording Steps

1. Open the Ducat frontend and choose MetaMask from the wallet list.
2. Show the MetaMask Snap install request and permissions.
3. Approve the Snap installation.
4. Connect and show the derived `sats`, `runes`, and `vault` addresses in the Ducat app.
5. Open MetaMask Snap home and show account addresses, BTC balance, UNIT balance, vault status, recent actions, clickable HTTPS app links, and copyable local routes.
6. Execute or stage a create-vault flow and show the compact Ducat PSBT confirmation summary, inputs, outputs, fees, warnings, and app metadata.
7. Execute or stage deposit BTC and show the confirmation summary.
8. Execute or stage borrow UNIT and show the confirmation summary.
9. Execute or stage repay UNIT and show the confirmation summary.
10. Execute or stage withdraw BTC and show the confirmation summary.
11. Execute or stage UNIT swap and show the confirmation summary.
12. Execute or stage liquidation/repossess and show the batch confirmation.
13. Sign an authentication message and show the message confirmation.
14. Disable and re-enable the Snap, then reconnect from the Ducat frontend.

## Evidence To Capture

- Every irreversible signing action shows a MetaMask confirmation.
- Confirmations include origin, network, signed input indexes, output summary, and fee when calculable.
- Private keys are never exported or shown.
- Mainnet is not available in the V1 manifest or UI.
- Xverse and UniSat remain available in the wallet list.
