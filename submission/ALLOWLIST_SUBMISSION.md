# MetaMask Allowlist Submission Draft

Date prepared: 2026-06-15

Use this file as the working copy for the MetaMask Snaps Directory Information form. Replace the remaining `PENDING_*` values before submission.

## Snap Identity

- Snap name: `Ducat`
- Package name: `@ducat-unit/wallet-snap`
- Snap ID: `npm:@ducat-unit/wallet-snap`
- Version to allowlist: `0.1.9`
- Repository URL: https://github.com/DUCAT-UNIT/ducat-snap
- npm URL: https://www.npmjs.com/package/@ducat-unit/wallet-snap
- Builder name: `DUCAT-UNIT`
- Builder URL: https://github.com/DUCAT-UNIT
- Snap website URL: https://app.ducatprotocol.com

## Description

Short description:

```text
Ducat Bitcoin accounts and Ducat-aware transaction signing in MetaMask.
```

Long description source: `LISTING.md`

Recommended long description:

```text
Ducat lets users connect MetaMask to Ducat Bitcoin mainnet, signet, and mutinynet app flows. It derives deterministic Bitcoin accounts inside MetaMask, keeps private keys inside MetaMask, and signs only explicit PSBT inputs requested by the Ducat web app.

The Ducat web app remains the action surface for create, deposit, borrow, repay, withdraw, swap, liquidation, and repossess flows. The Snap provides account discovery, BIP322-style message signing, PSBT signing, batch PSBT signing, a simple transfer path, Ducat-aware MetaMask confirmations, recent action history, and a Snap home page with copyable account addresses, BTC/UNIT balance, vault summary lookups, recent activity, and Ducat app routes.

Mainnet is enabled in this audit candidate and is included in the external security review scope.
```

## Audit

- Audit required: yes
- Reason: the Snap uses `snap_getBip32Entropy`
- Audit candidate tag: `audit-candidate-0.1.9-20260617-release-0.1.9`
- Audit candidate commit: tag target for `audit-candidate-0.1.9-20260617-release-0.1.9`
- Approved auditor: `PENDING_APPROVED_AUDITOR`
- Audited commit or tag: `PENDING_AUDIT_COMMIT`
- Fixed commit or tag: `PENDING_AUDIT_FIX_COMMIT`
- Audit report URL or PDF: `PENDING_AUDIT_REPORT_URL`
- Audit scope source: `AUDIT_SCOPE.md`
- Auditor handoff source: `AUDITOR_HANDOFF.md`

## Package And Verification

- Release evidence source: `RELEASE_EVIDENCE.md`
- Dependency audit source: `DEPENDENCY_AUDIT.md`
- Snapper review source: `SNAPPER_REVIEW.md`
- Verification command: `npm ci && npm run verify:release`
- GitHub verification: https://github.com/DUCAT-UNIT/ducat-snap/actions/workflows/verify.yml
- npm package shasum: `f263af21f954b12f2aeb994cec7f9bf7a1386226`
- npm package integrity: `sha512-tsFff+zfRK6UMk3sPxUuBKR+L5UqTZV2kel7FgbPfWMhur1ngtBONifNuwb1hY9V13fG6P/H9GPhmq7yKZ+cWQ==`
- Snap manifest source shasum: `vYMD8KsbcxClj28hsAFIWHc6VBkkKjunUebaqqaxp+Y=`

## Permissions Summary

- `endowment:rpc`: only approved Ducat frontend origins can invoke the Snap.
- `snap_getBip32Entropy`: derives Bitcoin account keys for `m/84'/0'`, `m/86'/0'`, `m/84'/1'`, and `m/86'/1'`.
- `snap_dialog`: shows mandatory confirmations before message signing, PSBT signing, batch signing, and transfers.
- `snap_manageState`: stores recent Ducat action metadata for Snap home.
- `snap_notify`: shows informational pending, completed, and failed-action notifications.
- `endowment:page-home`: shows Ducat account status and Ducat app routes in MetaMask.
- `endowment:network-access`: fetches public balance, vault, fee, UTXO, and broadcast data.
- `endowment:lifecycle-hooks`: shows the install notice.

## Support

- Public support URL or email: https://github.com/DUCAT-UNIT/ducat-snap/issues
- Escalation contact for MetaMask: `PENDING_ESCALATION_CONTACT`
- Response-time expectation: `PENDING_RESPONSE_TIME`
- Support source: `SUPPORT.md`
- Security contact or process: https://github.com/DUCAT-UNIT/ducat-snap/blob/audit-candidate-0.1.9-20260617-release-0.1.9/SECURITY.md
- Security source: `SECURITY.md`
- Privacy policy URL: https://github.com/DUCAT-UNIT/ducat-snap/blob/audit-candidate-0.1.9-20260617-release-0.1.9/PRIVACY.md
- Privacy source: `PRIVACY.md`

## Images And Demo

- Icon: `images/icon.svg`
- Screenshots directory: `submission/screenshots`
- Screenshots status: `PENDING_FINAL_SCREENSHOTS`
- Demo video URL: `PENDING_DEMO_VIDEO_URL`
- Demo script source: `DEMO_SCRIPT.md`

Required screenshots:

- Install approval screen for the Ducat Snap.
- Ducat app wallet modal showing MetaMask as a connector.
- Connected Ducat account addresses.
- PSBT confirmation for create or deposit showing an action title, origin, network, compact summary rows, signed input details, output details, fees, warnings, and Ducat app metadata.
- Batch confirmation for liquidation or repossess showing all-or-nothing signing, per-transaction rows, total fee, and warnings.
- Message signing confirmation showing origin, network, signing account, BIP322 signature type, message fingerprint, message length, and copyable message body.
- Transfer confirmation showing amount, fee, the `You pay` amount, change, sender, recipient, selected UTXOs, and broadcast endpoint.
- Snap home showing structured cards for accounts, BTC balance, UNIT balance, vault status, recent actions, clickable HTTPS app links, and copyable local development routes.

Required demo coverage:

- Install Snap.
- Connect wallet.
- Show derived accounts.
- Show Snap home.
- Sign create, deposit, borrow, repay, withdraw, swap, and liquidation/repossess actions.
- Sign an authentication message.
- Disable and re-enable the Snap, then reconnect from the frontend.

## Final Pre-Submit Checks

- `npm run verify:submission-ready` succeeds.
- Real create/deposit/borrow/repay/withdraw/swap/liquidation/repossess PSBT fixtures are present in `submission/fixtures/` and replay against the current Snap confirmation UI.
- Final E2E scenario evidence is present in `submission/e2e/evidence.json`.
- `npm view @ducat-unit/wallet-snap@0.1.9` returns the published package.
- `package.json` and `snap.manifest.json` versions match.
- `snap.manifest.json` source shasum matches the built bundle.
- The audited/fixed commit is public.
- The npm package was built from the audited/fixed commit.
- The audit report is public or attached in the required form field.
- All medium, high, and critical audit findings are fixed or formally accepted.
- Final production support, escalation, and privacy contacts are present.
- The demo video uses the same package version submitted for allowlisting.
- Frontend production config is not cut over until allowlist approval is received.
