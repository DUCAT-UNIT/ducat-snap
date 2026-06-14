# Ducat MetaMask Snap

`@ducat-unit/ducat-snap` is the Ducat Bitcoin account and signing Snap for MetaMask.

The Snap derives deterministic Bitcoin testnet accounts from the user's MetaMask Secret Recovery Phrase and exposes a small Ducat JSON-RPC API to the Ducat frontend. The Ducat web app remains the action surface. Users create, deposit, borrow, repay, withdraw, swap, and liquidate in the web app; the Snap handles account derivation, MetaMask confirmations, PSBT/message signing, transfer signing, recent action state, action notifications, and a Snap home page.

## Launch Scope

- Proposed Snap name: `Ducat`
- npm package: `@ducat-unit/ducat-snap`
- Snap ID after publish: `npm:@ducat-unit/ducat-snap`
- Local development Snap ID: `local:http://localhost:8080`
- V1 networks: `signet` and `mutinynet`
- Mainnet: intentionally disabled until audit, soak testing, and allowlist approval
- Derivation paths:
  - sats: `m/84'/1'/0'/0/0`, P2WPKH `tb1q...`, compressed 33-byte public key
  - runes/vault: `m/86'/1'/0'/0/0`, P2TR `tb1p...`, x-only 32-byte internal public key

## Requirements

- Node.js and npm. The repo is currently verified with the bundled Codex Node runtime, Node `24.14.0`.
- MetaMask with Snaps support.
- For `local:http://localhost:8080`, MetaMask must allow local Snap fetching. If MetaMask shows `Fetching local snaps is disabled`, enable local Snap development in MetaMask/Flask developer settings, then retry the install/update.
- A Ducat frontend checkout configured to use this Snap. The current integration branch uses `/Users/lucasrodriguez/Desktop/Ducat/frontend-metamask-snap`.

## Install

```bash
cd /Users/lucasrodriguez/Desktop/Ducat/SNAP
npm ci
```

## Verify

Use the normal development gate while editing:

```bash
npm run type-check
npm test
npm run build
npm run manifest
```

Or run the combined gate:

```bash
npm run verify
```

The stricter release gate also runs the production dependency audit, Snapper, and an npm package dry-run:

```bash
npm run verify:release
```

## Run Locally

Serve the Snap manifest and bundle:

```bash
cd /Users/lucasrodriguez/Desktop/Ducat/SNAP
npm run serve
```

The Snap is served from:

```text
http://localhost:8080
```

Every source, dependency, or icon change can change `snap.manifest.json`'s `source.shasum`. After changing the Snap, run:

```bash
npm run build
npm run manifest
```

Then restart `npm run serve` if the server is already running.

## Frontend Setup

In the Ducat frontend `.env.local`, point the MetaMask connector at the local Snap:

```bash
NEXT_PUBLIC_DUCAT_SNAP_ID="local:http://localhost:8080"
NEXT_PUBLIC_DUCAT_SNAP_VERSION=""
```

For the published Snap, use:

```bash
NEXT_PUBLIC_DUCAT_SNAP_ID="npm:@ducat-unit/ducat-snap"
NEXT_PUBLIC_DUCAT_SNAP_VERSION="^0.1.0"
```

Run the frontend on an origin allowed by `snap.manifest.json`, for example:

```bash
cd /Users/lucasrodriguez/Desktop/Ducat/frontend-metamask-snap
npm run dev -- -p 3002
```

Allowed local origins are:

- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:3002`
- `http://localhost:3003`

Allowed HTTPS QA origins are:

- `https://dev-git-feat-metamask-snap-connector-ducat.vercel.app`

These localhost origins are intentionally present for local development and Snap QA only. Do not remove them from the development manifest during local testing.

### Known Deferred Issue: Localhost Manifest Origins

`snap.manifest.json` currently includes localhost origins. That is intentional for local Snap development and QA, but the current development manifest is not directory-ready. Do not remove the localhost origins in this iteration; handle this as a dedicated release-manifest task before MetaMask submission.

Release update plan:

1. Keep the current development manifest available for local Snap testing.
2. Add a release manifest path or manifest-generation mode that removes every localhost origin.
3. Keep only approved HTTPS Ducat frontend origins in `endowment:rpc.allowedOrigins`.
4. Rebuild from the audited commit and regenerate the Snap manifest source shasum.
5. Update all release artifacts from that exact build: `RELEASE_EVIDENCE.md`, `AUDITOR_HANDOFF.md`, `submission/metamask-directory.json`, `submission/ALLOWLIST_SUBMISSION.md`, package shasum/integrity, screenshots, demo notes, and frontend production Snap env values.
6. Run `npm run build`, `npm run manifest`, `npm run verify:release-manifest`, `npm run verify:release`, and `npm run verify:submission-ready`.
7. Retag the final audit or submission candidate only after the release manifest, package evidence, and submission metadata are synced.

## MetaMask Local Update Flow

1. Run `npm run serve` in this repo.
2. Run the frontend with `NEXT_PUBLIC_DUCAT_SNAP_ID="local:http://localhost:8080"`.
3. Connect MetaMask from the Ducat wallet picker.
4. If the Snap was already installed and the local shasum changed, use the frontend `Update Snap` button in the wallet picker or connected wallet dropdown.
5. Approve the MetaMask update prompt.
6. Retry the Ducat action.

The connector intentionally does not call `wallet_requestSnaps` before every signature. Signing methods use `wallet_invokeSnap` against the installed Snap, so a stale local build must be updated explicitly.

## JSON-RPC API

- `ducat_getAccounts({ network })`
- `ducat_clearRecentActions()`
- `ducat_getCapabilities()`
- `ducat_signMessage({ network, address, message })`
- `ducat_signPsbt({ network, psbt, signInputs, context })`
- `ducat_signBatch({ network, entries, context })`
- `ducat_sendTransfer({ network, address, amountSats, feeRate })`
- `ducat_getHomeState({ network })`

## What Users See

MetaMask confirmations are intentionally action-specific and use structured sections and rows:

- Message signing shows the Ducat action label, origin, testnet network, signing account, BIP322 signature type, message length, message fingerprint, and copyable message body.
- PSBT signing shows the Ducat action label, origin, testnet network, compact summary rows, signed input details, output details, fee, warnings, and Ducat app metadata.
- Batch signing shows transaction count, all-or-nothing semantics, total fee, per-transaction summaries, and warning count.
- Simple BTC transfer shows amount, estimated fee, the `You pay` amount, change, sender, recipient, selected UTXO count/value, and broadcast endpoint.
- Snap Home shows structured cards for the last connected network, copyable BTC/UNIT/vault addresses, BTC and UNIT balances when services are available, vault status, recent action status, clickable links for HTTPS Ducat app origins, and copyable local routes during development. Approved Ducat origins can request a confirmed recent-action history clear.
- MetaMask notifications announce pending approvals, completed signing/broadcast actions, and non-rejection failures. Notifications are informational only and never gate signing behavior.

Errors returned to the frontend are friendly by default and include a stable `code` plus diagnostic `details` for developers. The frontend should display the `message` and keep details available for expanded debugging.

## Troubleshooting

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `Fetching local snaps is disabled` | MetaMask local Snap development is disabled. | Enable local Snap fetching in MetaMask/Flask developer settings, then retry install/update. |
| MetaMask asks to reinstall before signing | The served local Snap shasum changed. | Run `npm run build && npm run manifest`, restart `npm run serve`, then use the frontend `Update Snap` button. |
| `This site is not authorized to use the Ducat Snap` | The frontend origin is not in `snap.manifest.json`. | Use one of the allowed local origins or add the origin intentionally and regenerate the manifest. |
| `This transaction is trying to spend an input from a different Ducat Snap account` | The PSBT input does not match the derived Snap account requested in `signInputs`. | Refresh the frontend wallet account state and rebuild the Ducat transaction. Use diagnostic details to compare expected and actual input addresses. |
| Balance or vault status is unavailable on Snap Home | Public indexer or Ducat validator lookup timed out or failed. | Retry later. Signing still uses PSBT data supplied by the Ducat app. |

## Security Model

- Private keys never leave the Snap.
- The Snap only requests testnet BIP32 entropy paths in v1.
- Mainnet requests are rejected.
- Only explicit `signInputs` indexes are signed.
- Signing is restricted to derived Ducat Snap accounts.
- Every message, PSBT, batch, and transfer signing path requires MetaMask confirmation.
- Friendly frontend action context is display metadata only. Parsed PSBT data is the trusted signing summary.
- Unauthorized origins cannot invoke the Snap RPC API.

### Taproot Script-Path Policy

Vault PSBTs that spend Taproot script-path inputs must include tapleaf and control-block data that recomputes to the prevout P2TR output key. The Snap rejects uncommitted script-path inputs even if the leaf contains the derived Ducat vault key.

Mainnet support still requires a separate audit pass, but the signet/mutinynet Snap no longer contains the earlier alpha fallback that accepted uncommitted tapleaf data.

## Audit Readiness Plan

Use this plan to move the current audit candidate from "ready to review" to "ready to submit". Do not change `snap.manifest.json` localhost origins as part of this note; handle that as a dedicated release-manifest task before external submission.

Current candidate progress: duplicate previous-output rejection, missing previous-output data rejection, oversized signing request rejection, PSBT input/output size guard coverage, suspicious data-output warnings, malformed transfer broadcast txid rejection, bounded primitive app-context metadata validation, hostile app-context containment for decoded vault data, create/borrow/repay/withdraw/repo/liquidate vault action decode coverage, malformed Snap Home balance and vault-data rejection, public-account fixture replay for captured PSBT confirmation text, a HTTPS-only release-manifest verifier, and a final submission-readiness gate for fixtures, E2E evidence, screenshots, audit/demo URLs, and npm metadata are implemented. Remaining external evidence work is real transaction fixture capture, full E2E recording, final support/privacy/escalation details, npm publish evidence, and the third-party audit report.

1. Expand the Ducat transaction fixture corpus. Capture real client-sdk/validator PSBT fixtures for create, deposit, borrow, repay, withdraw, swap, liquidation, and repossess flows on mutinynet/signet. Include the exact Snap `WalletAccountRecord` and expected confirmation text so `npm run verify:fixtures` can replay OP_RETURN decoding, action labels, vault state summaries, data-output labels, warning behavior, and confirmation rendering without private keys.
2. Harden PSBT policy tests. Add adversarial cases for wrong network, unknown sign indexes, duplicate inputs, mixed account ownership, malicious frontend context, malformed data outputs, uncommitted Taproot script-path inputs, missing previous-output data, and suspicious zero-value outputs.
3. Split development and release configuration. Keep localhost origins and `local:http://localhost:8080` for development, but create a release manifest path that allows only approved HTTPS Ducat origins. Update CI to verify the release manifest, package shasum, and submission metadata together.
4. Complete E2E evidence. Record install, update, connect, reload reconnect, create, deposit, borrow, repay, withdraw, swap, liquidation, repossess, rejection, and disabled/re-enabled Snap flows using the same candidate bundle submitted to audit.
5. Lock the external submission packet. Finalize privacy/support/escalation contacts, screenshots, demo video, npm publish evidence, audited commit, fixed commit if needed, and the audit report. Update `submission/ALLOWLIST_SUBMISSION.md`, `submission/metamask-directory.json`, and `RELEASE_EVIDENCE.md` from that final candidate.

## Release Path

1. Confirm `npm run verify:release` passes from a clean checkout.
2. Update `RELEASE_EVIDENCE.md` for the audited candidate.
3. Tag the audit candidate.
4. Complete the third-party audit required for `snap_getBip32Entropy`.
5. Merge any audit fixes and tag the fixed candidate.
6. Publish `@ducat-unit/ducat-snap@0.1.0` to npm.
7. Replace pending external fields in `submission/metamask-directory.json` and `submission/ALLOWLIST_SUBMISSION.md`.
8. Capture real PSBT fixtures into `submission/fixtures/`.
9. Capture final E2E evidence into `submission/e2e/evidence.json`.
10. Capture final screenshots into `submission/screenshots/`.
11. Record the demo video using `DEMO_SCRIPT.md`.
12. Run `npm run verify:submission-ready`.
13. Submit the MetaMask allowlist/directory request with audit report, npm URL, public repo URL, demo video, support details, and listing assets.

## Useful Commands

```bash
npm run type-check
npm test
npm run build
npm run manifest
npm run serve
npm run verify
npm run verify:release
npm run verify:metadata
npm run verify:submission-ready
npm run audit:prod
npm run pack:dry-run
```
