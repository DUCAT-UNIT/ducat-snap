# MetaMask Allowlist Submission Draft

Date prepared: 2026-06-12

Use this file as the working copy for the MetaMask Snaps Directory Information form. Replace all `TODO` values before submission.

## Snap Identity

- Snap name: `Ducat`
- Package name: `@ducat-unit/ducat-snap`
- Snap ID: `npm:@ducat-unit/ducat-snap`
- Version to allowlist: `0.1.0`
- Repository URL: https://github.com/DUCAT-UNIT/ducat-snap
- npm URL: https://www.npmjs.com/package/@ducat-unit/ducat-snap
- Builder name: `DUCAT-UNIT`
- Builder URL: `TODO`
- Snap website URL: https://app.ducatprotocol.com

## Description

Short description:

```text
Ducat Bitcoin accounts and Ducat-aware transaction signing in MetaMask.
```

Long description source: `LISTING.md`

Recommended long description:

```text
Ducat lets users connect MetaMask to the Ducat Bitcoin signet and mutinynet app flows. It derives deterministic testnet Bitcoin accounts inside MetaMask, keeps private keys inside MetaMask, and signs only explicit PSBT inputs requested by the Ducat web app.

The Ducat web app remains the action surface for create, deposit, borrow, repay, withdraw, swap, liquidation, and repossess flows. The Snap provides account discovery, BIP322-style message signing, PSBT signing, batch PSBT signing, a simple transfer path, Ducat-aware MetaMask confirmations, recent action history, and a Snap home page with BTC/UNIT balance and vault summary lookups.

Mainnet is intentionally not enabled in this release.
```

## Audit

- Audit required: yes
- Reason: the Snap uses `snap_getBip32Entropy`
- Approved auditor: `TODO`
- Audited commit or tag: `TODO`
- Fixed commit or tag: `TODO`
- Audit report URL or PDF: `TODO`
- Audit scope source: `AUDIT_SCOPE.md`
- Auditor handoff source: `AUDITOR_HANDOFF.md`

## Package And Verification

- Release evidence source: `RELEASE_EVIDENCE.md`
- Dependency audit source: `DEPENDENCY_AUDIT.md`
- Snapper review source: `SNAPPER_REVIEW.md`
- Verification command: `npm ci && npm run verify:release`
- npm package shasum: `TODO`
- npm package integrity: `TODO`
- Snap manifest source shasum: `TODO`

## Permissions Summary

- `endowment:rpc`: only approved Ducat frontend origins can invoke the Snap.
- `snap_getBip32Entropy`: derives Bitcoin signet/mutinynet account keys for `m/84'/1'` and `m/86'/1'`.
- `snap_dialog`: shows mandatory confirmations before message signing, PSBT signing, batch signing, and transfers.
- `snap_manageState`: stores recent Ducat action metadata for Snap home.
- `endowment:page-home`: shows Ducat account status and app deep links in MetaMask.
- `endowment:network-access`: fetches public balance, vault, fee, UTXO, and broadcast data.
- `snap_notify`: reserved for post-release transaction status notifications.
- `endowment:lifecycle-hooks`: shows the install notice.

## Support

- Public support URL or email: `TODO`
- Escalation contact for MetaMask: `TODO`
- Response-time expectation: `TODO`
- Support source: `SUPPORT.md`
- Security contact or process: `TODO`
- Security source: `SECURITY.md`
- Privacy policy URL: `TODO`
- Privacy source: `PRIVACY.md`

## Images And Demo

- Icon: `images/icon.svg`
- Screenshots directory: `submission/screenshots`
- Screenshots status: `TODO`
- Demo video URL: `TODO`
- Demo script source: `DEMO_SCRIPT.md`

Required screenshots:

- Install approval screen for the Ducat Snap.
- Ducat app wallet modal showing MetaMask as a connector.
- Connected Ducat account addresses.
- PSBT confirmation for create or deposit.
- Batch confirmation for liquidation or repossess.
- Message signing confirmation.
- Snap home showing accounts, BTC balance, UNIT balance, vault status, recent actions, and deep links.

Required demo coverage:

- Install Snap.
- Connect wallet.
- Show derived accounts.
- Show Snap home.
- Sign create, deposit, borrow, repay, withdraw, swap, and liquidation/repossess actions.
- Sign an authentication message.
- Disable and re-enable the Snap, then reconnect from the frontend.

## Final Pre-Submit Checks

- `npm view @ducat-unit/ducat-snap@0.1.0` returns the published package.
- `package.json` and `snap.manifest.json` versions match.
- `snap.manifest.json` source shasum matches the built bundle.
- The audited/fixed commit is public.
- The npm package was built from the audited/fixed commit.
- The audit report is public or attached in the required form field.
- All medium, high, and critical audit findings are fixed or formally accepted.
- Final production support, escalation, and privacy contacts are present.
- The demo video uses the same package version submitted for allowlisting.
- Frontend production config is not cut over until allowlist approval is received.
