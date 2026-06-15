# Ducat MetaMask Snap

`@ducat-unit/wallet-snap` is the Ducat Bitcoin account and signing Snap for MetaMask. It derives deterministic mainnet, signet, and mutinynet Bitcoin accounts from the user's MetaMask Secret Recovery Phrase, keeps private keys inside MetaMask, and exposes a narrow Ducat JSON-RPC API to approved Ducat frontend origins.

The Ducat web app remains the user action surface. Users create, deposit, borrow, repay, withdraw, swap, liquidate, and repossess in the web app; the Snap handles account discovery, MetaMask confirmations, message signing, PSBT signing, batch signing, transfer signing, recent action state, notifications, and Snap Home.

## Release Candidate Status

- Package candidate: `@ducat-unit/wallet-snap@0.1.5`
- Snap ID: `npm:@ducat-unit/wallet-snap`
- Proposed Snap name: `Ducat`
- Audit candidate tag: `audit-candidate-0.1.5-20260615-guardian-allowlist`
- Audit candidate commit: tag target for `audit-candidate-0.1.5-20260615-guardian-allowlist`
- GitHub verification: `Verify Ducat Snap`
- Manifest source shasum: `zl9V64deyOgljY3WlY4xU2YDbG8K6NQChPorHBNq59w=`
- Package candidate digest evidence: `RELEASE_EVIDENCE.md`

Launch scope:

- Networks: `mainnet`, `signet`, and `mutinynet`
- Mainnet: enabled in this audit candidate
- Derivation paths:
  - sats mainnet: `m/84'/0'/0'/0/0`, P2WPKH `bc1q...`, compressed 33-byte public key
  - runes mainnet: `m/86'/0'/0'/0/0`, P2TR `bc1p...`, x-only 32-byte internal public key
  - vault mainnet: `m/86'/0'/0'/0/1`, P2TR `bc1p...`, x-only 32-byte internal public key
  - sats testnet: `m/84'/1'/0'/0/0`, P2WPKH `tb1q...`, compressed 33-byte public key
  - runes testnet: `m/86'/1'/0'/0/0`, P2TR `tb1p...`, x-only 32-byte internal public key
  - vault testnet: `m/86'/1'/0'/0/1`, P2TR `tb1p...`, x-only 32-byte internal public key

## Install

```bash
npm ci
```

Recommended local edit gate:

```bash
npm run type-check
npm test -- --runInBand
npm run build
npm run manifest
npm run harness:accounts
npm run harness:smoke-signing
```

Full release gate:

```bash
npm run verify:release
```

`verify:release` runs type checking, Jest, build, manifest regeneration, MetaMask simulation harness checks, production dependency audit, Snapper, release metadata verification, release manifest verification, and `npm pack --dry-run`.

## Run Locally

Serve the local Snap:

```bash
npm run serve
```

The local Snap is served at:

```text
http://localhost:8080
```

For local frontend testing:

```bash
NEXT_PUBLIC_DUCAT_SNAP_ID="local:http://localhost:8080"
NEXT_PUBLIC_DUCAT_SNAP_VERSION=""
```

For the published Snap:

```bash
NEXT_PUBLIC_DUCAT_SNAP_ID="npm:@ducat-unit/wallet-snap"
NEXT_PUBLIC_DUCAT_SNAP_VERSION="^0.1.5"
```

Allowed HTTPS Ducat origins in the published mainnet manifest:

- `https://app.ducatprotocol.com`
- `https://dev.app.ducatprotocol.com`
- `https://staging.app.ducatprotocol.com`

The published manifest authorizes only stable, org-controlled HTTPS Ducat origins. Local development (`http://localhost`) and ephemeral, re-registerable preview deployments (`*.vercel.app`) are deliberately excluded so a local process or a taken-over preview subdomain can never drive mainnet signing; use a separate, unpublished dev manifest for local Snap QA. The release verifier rejects localhost, non-HTTPS, wildcard, duplicate, or unknown origins in the shipped manifest.

## JSON-RPC API

- `ducat_getAccounts({ network })`
- `ducat_getCapabilities()`
- `ducat_signMessage({ network, address, message })`
- `ducat_signPsbt({ network, psbt, signInputs, context })`
- `ducat_signBatch({ network, entries, context })`
- `ducat_sendTransfer({ network, address, amountSats, feeRate })`
- `ducat_getHomeState({ network })`
- `ducat_clearRecentActions()`

## User Confirmation Surface

MetaMask confirmations are action-specific and structured:

- Message signing shows the Ducat action label, origin, network, account, BIP322 signature type, message length, message fingerprint, and copyable message body.
- PSBT signing shows the Ducat action label, origin, network, summary rows, signed input details, output details, fee, warnings, and Ducat app metadata.
- Batch signing shows transaction count, all-or-nothing semantics, total fee, per-transaction summaries, and warning count.
- Simple BTC transfer shows amount, estimated fee, `You pay`, change, sender, recipient, selected UTXOs, and broadcast endpoint.
- Snap Home shows last connected network, copyable BTC/UNIT/vault addresses, public balance and vault lookups when available, recent action state, approved HTTPS Ducat app links, and local development routes.

Errors returned to the frontend include a stable `code`, user-facing `message`, and diagnostic `details` for expanded debugging.

## Security Model

- Private keys, child private keys, WIFs, and raw entropy never leave the Snap.
- The Snap requests Bitcoin mainnet and testnet BIP32 entropy paths: `m/84'/0'`, `m/86'/0'`, `m/84'/1'`, and `m/86'/1'`.
- Mainnet requests use Bitcoin mainnet addresses, transaction parsing, and broadcast endpoints; signet and mutinynet requests use Bitcoin testnet parameters.
- Unauthorized origins cannot invoke the Snap RPC API.
- Only explicit `signInputs` indexes are signed.
- Signing is restricted to derived Ducat Snap accounts.
- Message, PSBT, batch, and transfer signing require MetaMask confirmation.
- Frontend context is treated as untrusted display metadata. Parsed PSBT data is the signing source of truth.
- Snap state stores recent Ducat action metadata only.

Taproot script-path inputs must include a Ducat cosign tapleaf and control-block data that recomputes to the prevout P2TR output key. The tapleaf must place the derived Ducat vault key in the client slot, and the client and guard pubkeys must be distinct. The Snap rejects uncommitted script-path inputs, client/guard key collapse, and generic leaves even when a leaf contains the derived vault key.

## Audit And Submission Packet

Primary audit documents:

- `AUDITOR_HANDOFF.md`
- `AUDIT_SCOPE.md`
- `RELEASE_EVIDENCE.md`
- `INTERNAL_SECURITY_REVIEW.md`
- `DEPENDENCY_AUDIT.md`
- `SNAPPER_REVIEW.md`

Submission documents:

- `submission/README.md`
- `submission/ALLOWLIST_SUBMISSION.md`
- `submission/EXTERNAL_GATES.md`
- `submission/metamask-directory.json`
- `submission/fixtures/README.md`
- `submission/e2e/README.md`
- `submission/screenshots/README.md`

The source, package, metadata, and local verification evidence are ready for external audit handoff. MetaMask directory submission still requires the third-party audit report, final screenshots, demo video, real transaction fixtures, final E2E evidence, and project-owned support/escalation details listed in `submission/EXTERNAL_GATES.md`.

## Useful Commands

```bash
npm run type-check
npm test -- --runInBand
npm run build
npm run manifest
npm run verify:harness
npm run verify:release
npm run verify:metadata
npm run verify:release-manifest
npm run verify:submission-ready
npm run audit:prod
npm run pack:dry-run
```
