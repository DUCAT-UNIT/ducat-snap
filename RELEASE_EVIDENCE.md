# Ducat Snap Release Evidence

Date: 2026-06-12

This document captures the current local audit and submission handoff state for `@ducat-unit/ducat-snap` v0.1.0.

## Source

- Public repository: https://github.com/DUCAT-UNIT/ducat-snap
- Implementation branch: `feat/btc-snap-mutinynet-tx-open`
- Implementation commit: `bd9202402fae808e1815f68de51b147bf428c80e`
- Implementation tag: `audit-candidate-0.1.0-20260613-metadata-guard`
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
- GitHub Actions run: https://github.com/DUCAT-UNIT/ducat-snap/actions/runs/27446702134

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
- Jest tests: 33 passed
- Covered areas:
  - Deterministic signet/mutinynet account derivation
  - `ducat_getAccounts`
  - Derived-address-only message signing
  - Copyable message confirmation rendering for arbitrary signing content
  - Compact action-specific PSBT confirmation rendering with parsed output facts and Ducat app metadata
  - OP_RETURN data-output labeling
  - PSBT input ownership and network validation
  - Ducat alpha Taproot script-path signing compatibility
  - Ducat alpha Taproot script-path warning surfacing
  - RPC origin validation
  - Manifest/RPC allowed-origin sync
  - `ducat_getCapabilities`
  - Confirmed recent-action clearing
  - Snap Home rendering from last connected network and origin
  - Recent-action state validation, sorting, capping, and clearing
  - Transfer UTXO selection, dust-change fee display, and insufficient funds rejection
  - Malformed PSBT rejection
  - User-declined confirmation rejection
  - Batch order preservation and whole-batch invalid rejection

## Package Evidence

- Package dry-run command: `npm pack --dry-run --json`
- Dry-run filename: `ducat-unit-ducat-snap-0.1.0.tgz`
- Dry-run package size: `1319121`
- Dry-run unpacked size: `2234174`
- Dry-run file count: `15`
- npm package shasum: `76a39fd69b33beceee65f090545d25787f513b0a`
- npm package integrity: `sha512-z+6ZARUhQiV7+VAUCKT45Kwru/3o//g/nWH7JORIe3ympltLz2tVlysC8YZvfx/BlzlkKQBT3Ti6qzk1HbPFjg==`
- Snap manifest source shasum: `gR2z1FUeF6YR0FLYW9pw+4fENZDoZ/5dSGja6792vKs=`
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
- Snapper result: completed with 166 low-risk ESLinting findings
- Snapper review: see `SNAPPER_REVIEW.md`
- Current release stance: findings are documented and not treated as a v0.1.0 release blocker pending third-party audit review

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
- Signet/mutinynet alpha vault PSBTs currently use a compatibility path for Taproot script-path inputs in `src/psbt.ts`; this must be reviewed by the auditor and tightened before mainnet.
- `snap_getBip32Entropy` requires third-party audit before MetaMask directory submission.
- Production support and legal privacy URLs must be finalized before submission.

## Remaining External Gates

- Keep GitHub Actions green on the cleanup PR.
- Send `audit-candidate-0.1.0-20260613-metadata-guard` to the external Snap auditor.
- Configure npm authentication for the `@ducat-unit` package scope.
- Publish `@ducat-unit/ducat-snap@0.1.0` to npm after audit fixes, if any.
- Schedule and complete the third-party audit required for `snap_getBip32Entropy`.
- Merge audit fixes, if any, and tag the fixed source commit.
- Capture final listing screenshots from the audited build.
- Record the demo video from `DEMO_SCRIPT.md`.
- Submit the MetaMask allowlist/directory request with the audit report, npm URL, public repo URL, source commits, demo video, support details, and listing assets.
- After allowlist approval, update frontend production configuration to the npm Snap ID and approved release range.
- Run final signet/mutinynet E2E coverage for install, connect, create, deposit, borrow, repay, withdraw, swap, and liquidation/repossess.
