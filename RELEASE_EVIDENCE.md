# Ducat Snap Release Evidence

Date: 2026-06-12

This document captures the current audit and submission handoff state for `@ducat-unit/ducat-snap` v0.1.0.

## Source

- Public repository: https://github.com/DUCAT-UNIT/ducat-snap
- Implementation commit: `ef2c1489e27807f80aa8ecda19db1284f5031632`
- Implementation tag: `audit-candidate-0.1.0-20260612-copyable-message`
- Package name: `@ducat-unit/ducat-snap`
- Version: `0.1.0`
- Proposed Snap name: `Ducat`
- Launch network: signet/mutinynet only

## Automated Verification

- GitHub Actions workflow: `Verify Ducat Snap`
- Run URL: https://github.com/DUCAT-UNIT/ducat-snap/actions/runs/27437420295
- Run conclusion: `success`
- Run head SHA: `ef2c1489e27807f80aa8ecda19db1284f5031632`
- Local release command: `npm run verify:release`
- Local release command result: passed
- Separate publish dry-run command: `npm publish --dry-run --access public`
- Separate publish dry-run result: passed

`npm run verify:release` currently covers:

- `npm run type-check`
- `npm test`
- `npm run build`
- `npm run manifest`
- `npm audit --omit=dev`
- `npm run snapper`
- `npm pack --dry-run`

## Test Evidence

- Jest suites: 4 passed
- Jest tests: 17 passed
- Covered areas:
  - Deterministic signet/mutinynet account derivation
  - `ducat_getAccounts`
  - Derived-address-only message signing
  - Copyable message confirmation rendering for arbitrary signing content
  - PSBT input ownership and network validation
  - RPC origin validation
  - Malformed PSBT rejection
  - User-declined confirmation rejection
  - Batch order preservation and whole-batch invalid rejection

## Package Evidence

- Tarball path: `/Users/lucasrodriguez/Desktop/Ducat/SNAP/ducat-unit-ducat-snap-0.1.0.tgz`
- Tarball SHA-256: `3dc81725d3eb8abed66acbb7689520f02b42a46103a5d89a69b0ae553577ae7b`
- npm package shasum: `94f6a0c37c23f3b007ad44fe027d63562b70931d`
- npm package integrity: `sha512-S4NNEWEcrInk1EB9Mvb6/iEiJD8das47ggdzilYdN556dw2GTyaqyAdjIKgRjNL3E1FEfa+JpNE1kN0TewAglQ==`
- Snap manifest source shasum: `6JcS73lpuUpJ9QQbeC2s1jlCDS+/R4LeaBQMKL32XEA=`
- `npm publish --dry-run --access public`: passed
- Actual npm publish: blocked until npm auth is configured
- `npm whoami`: `ENEEDAUTH`
- `npm view @ducat-unit/ducat-snap`: `E404`; package is not published yet

## Security Scan Evidence

- Production dependency audit: passed with 0 production vulnerabilities
- Direct `dependencies` and `devDependencies` are pinned to exact versions in `package.json`.
- Transitive dependency versions are locked by `package-lock.json`.
- Snapper command: `npx --yes @sayfer_io/snapper --path . --output snapper-report.json`
- Snapper result: completed with 96 ESLinting findings
- Snapper review: see `SNAPPER_REVIEW.md`
- Current release stance: findings are documented and not treated as a v0.1.0 release blocker pending third-party audit review

## Frontend Integration Evidence

- Frontend PR: https://github.com/DUCAT-UNIT/frontend/pull/675
- PR status: draft
- Branch: `feat/metamask-snap-connector`
- Base branch: `fix/admin-dashboard-api-hooks`
- Current head commit after rebase: `73fb5c61`
- Local worktree: `/Users/lucasrodriguez/Desktop/Ducat/frontend-metamask-snap`

Local frontend verification passed:

- `npm run type-check`
- `npm test -- --runInBand`
- Scoped Biome check for changed Snap connector files
- `npm run build`

Known frontend CI note:

- Vercel alpha currently fails before build because the environment cannot read `@ducat-unit/runestone@1.0.5` from GitHub Packages without the expected npm token.
- This is considered non-blocking for the Snap implementation per project direction.
- The Vercel dev and Storybook checks passed.

## Base Branch Fix Evidence

- Admin API hook base-fix PR: https://github.com/DUCAT-UNIT/frontend/pull/676
- Branch: `fix/admin-dashboard-api-hooks`
- Base branch: `fix/admin-panel-number-sizes`
- Commit: `25850ddf`
- Purpose: add the missing tracked admin API hooks required for base branch type-check.

Local base-fix verification passed:

- `npm run type-check`
- Scoped Biome check for changed admin hook files

Known base-fix CI note:

- Vercel alpha currently fails for the same GitHub Packages npm-token issue.
- This is considered non-blocking for the Snap implementation per project direction.

## Remaining External Gates

- Configure npm authentication for the `@ducat-unit` package scope.
- Publish `@ducat-unit/ducat-snap@0.1.0` to npm.
- Schedule and complete a third-party audit because the Snap uses `snap_getBip32Entropy`.
- Merge audit fixes, if any, and tag the fixed source commit.
- Capture final listing screenshots from the audited build.
- Record the demo video from `DEMO_SCRIPT.md`.
- Submit the MetaMask allowlist/directory request with the audit report, npm URL, public repo URL, source commits, demo video, support details, and listing assets.
- After allowlist approval, update frontend production configuration to the npm Snap ID and approved release range.
- Run final signet/mutinynet E2E coverage for install, connect, create, deposit, borrow, repay, withdraw, swap, and liquidation/repossess.
