# Ducat Snap Release Evidence

Date: 2026-06-12

This document captures the current local audit and submission handoff state for `@ducat-unit/ducat-snap` v0.1.0.

## Source

- Public repository: https://github.com/DUCAT-UNIT/ducat-snap
- Implementation commit: `087b7c7f797311f3208ee4caa20fe46aca4c5b04`
- Implementation tag: not yet tagged after cleanup
- Package name: `@ducat-unit/ducat-snap`
- Version: `0.1.0`
- Proposed Snap name: `Ducat`
- Launch network: signet/mutinynet only
- Mainnet: intentionally disabled

## Automated Verification

- Local release command: `npm run verify:release`
- Local release command result: passed
- GitHub Actions workflow: `Verify Ducat Snap`
- GitHub Actions status for this cleanup commit: pending until pushed

`npm run verify:release` covers:

- `npm run type-check`
- `npm test`
- `npm run build`
- `npm run manifest`
- `npm audit --omit=dev`
- `npm run snapper`
- `npm pack --dry-run`

## Test Evidence

- Jest suites: 4 passed
- Jest tests: 20 passed
- Covered areas:
  - Deterministic signet/mutinynet account derivation
  - `ducat_getAccounts`
  - Derived-address-only message signing
  - Copyable message confirmation rendering for arbitrary signing content
  - PSBT input ownership and network validation
  - Ducat alpha Taproot script-path signing compatibility
  - RPC origin validation
  - Malformed PSBT rejection
  - User-declined confirmation rejection
  - Batch order preservation and whole-batch invalid rejection

## Package Evidence

- Package dry-run command: `npm pack --dry-run --json`
- Dry-run filename: `ducat-unit-ducat-snap-0.1.0.tgz`
- Dry-run package size: `1313053`
- Dry-run unpacked size: `2213950`
- Dry-run file count: `15`
- npm package shasum: `5e2e6ba93583822e83b2c09c3e2078c513297f9e`
- npm package integrity: `sha512-RCF4uLbPP0puqnI+m8G5n3b8Y6VDo3xrERrLdC/nRL2rnfjlJWKyGIt8jxXWSzcXUBV9kyx6cAbocmwJf8IIlw==`
- Snap manifest source shasum: `/IHujYHc/LA19OQAmbn6PX50JRtdFwoRNgNC/nstIUE=`
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
- Snapper result: completed with 100 ESLinting findings
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

- Push this cleanup/evidence state.
- Wait for GitHub Actions on the pushed commit.
- Tag the audit candidate.
- Configure npm authentication for the `@ducat-unit` package scope.
- Publish `@ducat-unit/ducat-snap@0.1.0` to npm after audit fixes, if any.
- Schedule and complete the third-party audit required for `snap_getBip32Entropy`.
- Merge audit fixes, if any, and tag the fixed source commit.
- Capture final listing screenshots from the audited build.
- Record the demo video from `DEMO_SCRIPT.md`.
- Submit the MetaMask allowlist/directory request with the audit report, npm URL, public repo URL, source commits, demo video, support details, and listing assets.
- After allowlist approval, update frontend production configuration to the npm Snap ID and approved release range.
- Run final signet/mutinynet E2E coverage for install, connect, create, deposit, borrow, repay, withdraw, swap, and liquidation/repossess.
