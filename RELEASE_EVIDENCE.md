# Ducat Snap Release Evidence

Date: 2026-06-14

This document captures the current local audit and submission handoff state for `@ducat-unit/ducat-snap` v0.1.0.

## Source

- Public repository: https://github.com/DUCAT-UNIT/ducat-snap
- Implementation branch: `feat/btc-snap-mutinynet-tx-open`
- Implementation tag: `audit-candidate-0.1.0-20260614-submission-gate`
- Implementation commit: resolve from the tag with `git rev-list -n 1 audit-candidate-0.1.0-20260614-submission-gate`
- Package name: `@ducat-unit/ducat-snap`
- Version: `0.1.0`
- Proposed Snap name: `Ducat`
- Launch network: signet/mutinynet only
- Mainnet: intentionally disabled

## Automated Verification

- Local release command: `npm run verify:release`
- Local release command result: passed
- Pull request: https://github.com/DUCAT-UNIT/ducat-snap/pull/1
- Pull request status: draft
- GitHub Actions workflow: `Verify Ducat Snap`
- GitHub Actions status for audit candidate commit: passed
- GitHub Actions evidence: see the current checks on https://github.com/DUCAT-UNIT/ducat-snap/pull/1
- GitHub Actions release metadata check: enabled in `.github/workflows/verify.yml`

`npm run verify:release` covers:

- `npm run type-check`
- `npm test`
- `npm run build`
- `npm run manifest`
- `npm audit --omit=dev`
- `npm run snapper`
- `npm run verify:metadata`
- `npm pack --dry-run`

## Test Evidence

- Jest suites: 6 passed
- Jest tests: 62 passed
- Covered areas:
  - Deterministic signet/mutinynet account derivation
  - `ducat_getAccounts`
  - Derived-address-only message signing
  - Copyable message confirmation rendering for arbitrary signing content
  - Compact action-specific PSBT confirmation rendering with parsed output facts and Ducat app metadata
  - Ducat vault OP_RETURN return-data decoding
  - Current Ducat core vault OP_RETURN decoding with guardian and oracle commit payloads
  - Borrow, repay, repo, and liquidate/trim sequence-action decoding
  - Create and withdraw sequence-action decoding
  - Malformed Ducat-looking OP_RETURN warning behavior
  - Decoded Ducat vault action and after-state confirmation rendering
  - Decoded vault data takes precedence over hostile app-supplied action, effect, and amount context
  - Bounded primitive app-context metadata rendering
  - Structured app-context metadata ignored instead of stringified into confirmations
  - Multisig labeling for signed UNIT/vault Taproot inputs
  - OP_RETURN data-output labeling
  - Value-bearing OP_RETURN and zero-value unknown-script warning behavior
  - PSBT input ownership and network validation
  - Duplicate requested PSBT input index rejection before entropy or confirmation
  - Oversized requested sign-input rejection before entropy or confirmation
  - Duplicate previous-output rejection for hostile serialized PSBTs
  - Missing previous-output value data rejection before signing
  - PSBT input/output count guard rejection before signing
  - Committed Taproot script-path signing
  - Uncommitted Taproot script-path rejection
  - RPC origin validation
  - Manifest/RPC allowed-origin sync
  - `ducat_getCapabilities`
  - Confirmed recent-action clearing
  - Compact Snap Home status rendering from last connected network and origin
  - Malformed Snap Home public balance and vault response values displayed as unavailable
  - Recent-action state validation, sorting, capping, and clearing
  - Transfer UTXO selection, dust-change fee display, and insufficient funds rejection
  - Malformed transfer broadcast txid rejection and failed-action recording
  - Malformed PSBT rejection
  - User-declined confirmation rejection
  - Batch order preservation and whole-batch invalid rejection

## Package Evidence

- Package dry-run command: `npm pack --dry-run --json`
- Dry-run filename: `ducat-unit-ducat-snap-0.1.0.tgz`
- Dry-run package size: `1327033`
- Dry-run unpacked size: `2259666`
- Dry-run file count: `15`
- npm package shasum: `f9cc86661464ebc413bea04f032c611bdb43351e`
- npm package integrity: `sha512-g1ziJw6EwnZIHAn6OTCuJ95SWkE0D4fTBiekEM1/PHXoaTf8ho0BusqZuYeV7lDhuv0HIFYtWYrWOa8aAaAoTA==`
- Snap manifest source shasum: `33nzukIWk+TySkR9mkqz+xijVJmkyS3EfpelnOjDDM0=`
- Actual npm publish: blocked until npm auth is configured

Packaged files:

- `AUDIT_SCOPE.md`
- `DEMO_SCRIPT.md`
- `DEPENDENCY_AUDIT.md`
- `LICENSE`
- `LISTING.md`
- `PRIVACY.md`
- `README.md`
- `RELEASE_CHECKLIST.md`
- `SECURITY.md`
- `SNAPPER_REVIEW.md`
- `SUPPORT.md`
- `dist/bundle.js`
- `images/icon.svg`
- `package.json`
- `snap.manifest.json`

## Security Scan Evidence

- Production dependency audit: passed with 0 production vulnerabilities
- Direct `dependencies` and `devDependencies` are pinned to exact versions in `package.json`.
- Transitive dependency versions are locked by `package-lock.json`.
- Snapper command: `npx --yes @sayfer_io/snapper --path . --output snapper-report.json`
- Snapper result: completed with 211 low-risk ESLinting findings
- Snapper review: see `SNAPPER_REVIEW.md`
- Current release stance: findings are documented and not treated as a v0.1.0 release blocker pending third-party audit review
- Release manifest guard: `npm run verify:release-manifest` derives a submission manifest origin set from `submission/metamask-directory.json` and fails if any release origin is localhost, non-HTTPS, duplicated, wildcarded, or outside the current development manifest.
- Submission-ready guard: `npm run verify:submission-ready` is intentionally separate from release CI and fails with a complete blocker list until pending external fields are replaced, real PSBT fixtures exist for every required Ducat flow, final E2E scenario evidence is captured, final PNG screenshots exist, audit/demo URLs are HTTPS, and the published npm package metadata matches the submission packet.

## Frontend Integration Evidence

- Frontend PR: https://github.com/DUCAT-UNIT/frontend/pull/675
- PR status: draft
- Branch: `feat/metamask-snap-connector`
- Local current commit: `d242e1cb`
- Local worktree: `/Users/lucasrodriguez/Desktop/Ducat/frontend-metamask-snap`

Local frontend verification previously passed on the integration branch:

- Connector Jest coverage
- `npm run type-check`
- Scoped Biome check for changed Snap connector files
- `npm run build`

Known frontend CI note:

- Vercel alpha can fail before build when the environment cannot read private `@ducat-unit/*` packages from GitHub Packages without the expected npm token.
- This is considered non-blocking for the Snap implementation per project direction.

## Known Pre-Audit Notes

- The Snap uses the real Ducat circle mark from the app assets at `images/icon.svg`.
- Taproot script-path inputs must prove the provided tapleaf commits to the prevout P2TR output key. The earlier alpha fallback for uncommitted tapleaf data has been removed.
- `snap_getBip32Entropy` requires third-party audit before MetaMask directory submission.
- Production support and legal privacy URLs must be finalized before submission.

## Remaining External Gates

- Keep GitHub Actions green on the cleanup PR.
- Send `audit-candidate-0.1.0-20260614-submission-gate` to the external Snap auditor.
- Configure npm authentication for the `@ducat-unit` package scope.
- Publish `@ducat-unit/ducat-snap@0.1.0` to npm after audit fixes, if any.
- Schedule and complete the third-party audit required for `snap_getBip32Entropy`.
- Merge audit fixes, if any, and tag the fixed source commit.
- Capture final listing screenshots from the audited build.
- Record the demo video from `DEMO_SCRIPT.md`.
- Capture real transaction fixtures in `submission/fixtures/` and final E2E evidence in `submission/e2e/evidence.json`.
- Submit the MetaMask allowlist/directory request with the audit report, npm URL, public repo URL, source commits, demo video, support details, and listing assets.
- After allowlist approval, update frontend production configuration to the npm Snap ID and approved release range.
- Run final signet/mutinynet E2E coverage for install, connect, create, deposit, borrow, repay, withdraw, swap, and liquidation/repossess.
