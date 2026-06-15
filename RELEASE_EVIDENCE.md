# Ducat Snap Release Evidence

Date: 2026-06-15

This document records the source, package, verification, and remaining external-gate status for `@ducat-unit/wallet-snap@0.1.5`.

## Source

- Public repository: https://github.com/DUCAT-UNIT/ducat-snap
- Candidate tag: `audit-candidate-0.1.5-20260615-guardian-allowlist`
- Candidate commit: tag target for `audit-candidate-0.1.5-20260615-guardian-allowlist`
- Package name: `@ducat-unit/wallet-snap`
- Version: `0.1.5`
- Snap ID: `npm:@ducat-unit/wallet-snap`
- Proposed Snap name: `Ducat`
- Launch networks: mainnet, signet, and mutinynet
- Mainnet: enabled in this audit candidate

## Package Candidate

- npm URL: https://www.npmjs.com/package/@ducat-unit/wallet-snap
- Candidate version: `0.1.5`
- Target npm dist-tag: `latest`
- npm package shasum: `7cdb944c422ffbec212f632838711bdf978ee0dc`
- npm package integrity: `sha512-DG6/zfAM3DXvJb1NjMUrcuGsEGqFBhTRxnsveoCtPEFF2dOEvMZB88MlvhfvxsDrEndkcQzZwx3LlG6h28LPig==`
- Snap manifest source shasum: `0lNJAaEdLVNF1Y57h2WPLbHScSPRn3G3+MFHZxaQjP8=`
- Dry-run package size: `1327653`
- Dry-run unpacked size: `2262264`
- Dry-run file count: `15`

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

## Automated Verification

- Local release command: `npm run verify:release`
- Local release result: passed before final metadata refresh; rerun after tagging the handoff commit
- GitHub workflow: `Verify Ducat Snap`
- GitHub Actions run: https://github.com/DUCAT-UNIT/ducat-snap/actions/workflows/verify.yml
- GitHub Actions result: pending for the new audit candidate until pushed
- Release workflow file: `.github/workflows/verify.yml`
- Release workflow command: `npm run verify:release`

`npm run verify:release` covers:

- `npm run type-check`
- `npm test`
- `npm run build`
- `npm run manifest`
- `npm run verify:harness`
- `npm audit --omit=dev`
- `npm run snapper`
- `npm run verify:metadata`
- `npm run verify:release-manifest`
- `npm pack --dry-run`

## Test Evidence

- Jest suites: 8 passed
- Jest tests: 80 passed
- MetaMask simulation harness account smoke: passed
- MetaMask simulation harness deterministic P2WPKH signing smoke: passed

Covered areas include:

- Deterministic mainnet/signet/mutinynet account derivation
- Public account ownership reconstruction for fixture replay without private keys
- `ducat_getAccounts`
- `ducat_getCapabilities`
- Capabilities version synchronized with `package.json`
- Capabilities and release metadata expose mainnet support
- Derived-address-only message signing
- Copyable message confirmation rendering for arbitrary signing content
- Compact action-specific PSBT confirmation rendering
- Ducat vault OP_RETURN return-data decoding
- Current Ducat core vault OP_RETURN decoding
- Borrow, repay, repo, and liquidate/trim sequence-action decoding
- Create and withdraw sequence-action decoding
- Malformed Ducat-looking OP_RETURN warning behavior
- Decoded vault data precedence over hostile frontend context
- Bounded primitive app-context metadata rendering
- Structured app-context metadata rejection from confirmations
- Multisig labeling for signed UNIT/vault Taproot inputs
- OP_RETURN data-output labeling
- Value-bearing OP_RETURN and zero-value unknown-script warnings
- PSBT input ownership and network validation
- Duplicate requested PSBT input index rejection before entropy or confirmation
- Oversized requested sign-input rejection before entropy or confirmation
- Duplicate previous-output rejection for hostile serialized PSBTs
- Missing previous-output value rejection before signing
- PSBT input/output count guard rejection before signing
- Distinct UNIT and vault Taproot account derivation
- Committed Ducat cosign Taproot script-path signing
- Generic committed Taproot script-path rejection
- Uncommitted Taproot script-path rejection
- Duplicate-key Ducat cosign leaf rejection
- RPC origin validation
- Manifest/RPC allowed-origin synchronization
- Confirmed recent-action clearing
- Snap Home state rendering
- Network-specific Snap Home validator endpoint selection
- Mainnet account records use Bitcoin mainnet coin-type paths and `bc1` addresses
- Malformed Snap Home balance and vault-data handling
- Transfer UTXO selection, dust-change fee display, and insufficient funds rejection
- Malformed transfer broadcast txid rejection and failed-action recording
- Malformed PSBT rejection
- User-declined confirmation rejection
- Batch order preservation and whole-batch invalid rejection
- Submission fixture replay harness and artifact hygiene checks
- Exact npm package artifact allowlist enforcement
- Audit candidate tag, target-commit, and clean tracked worktree enforcement

## Security Scan Evidence

- Production dependency audit: passed with 0 production vulnerabilities
- Direct `dependencies` and `devDependencies` are pinned to exact versions in `package.json`
- Transitive dependency versions are locked by `package-lock.json`
- Snapper command: `npx --yes @sayfer_io/snapper --path . --output snapper-report.json`
- Snapper result: completed with 206 low-risk ESLinting findings
- Snapper review: see `SNAPPER_REVIEW.md`
- Release stance: findings are documented and not treated as a v0.1.5 blocker pending third-party audit review

## Release Guards

- `prepublishOnly` runs `npm run verify:release`.
- `npm run verify:metadata` checks version, package shasum, package integrity, manifest shasum, candidate tag, candidate commit, package file allowlist, and tracked worktree cleanliness.
- `npm run verify:release-manifest` derives a submission manifest origin set from `submission/metamask-directory.json` and rejects localhost, non-HTTPS, wildcard, duplicate, or unknown release origins.
- `npm run verify:submission-ready` remains separate from release CI and blocks MetaMask submission until the third-party audit, screenshots, demo video, fixtures, E2E evidence, registry package metadata, and pending submission fields are complete.

## Frontend Integration Evidence

- Frontend PR: https://github.com/DUCAT-UNIT/frontend/pull/675
- Connector branch: `feat/metamask-snap-connector`
- Snap package reference: `npm:@ducat-unit/wallet-snap`
- Default Snap version range: `^0.1.5`
- Required production cutover: keep `NEXT_PUBLIC_DUCAT_SNAP_ID=npm:@ducat-unit/wallet-snap` and use an allowlisted release range after MetaMask approval

The frontend version range should accept `0.1.5` before using this candidate outside local testing.

## Known Pre-Audit Notes

- The Snap uses the Ducat circle mark from app assets at `images/icon.svg`.
- Taproot script-path inputs must prove the supplied tapleaf commits to the prevout P2TR output key.
- `snap_getBip32Entropy` requires a third-party audit before MetaMask directory submission.
- Production support, escalation, and legal privacy URLs must be finalized before submission.

## Remaining External Gates

- Send `audit-candidate-0.1.5-20260615-guardian-allowlist` to the external Snap auditor.
- Schedule and complete the third-party audit required for `snap_getBip32Entropy`.
- Merge audit fixes, if any, and tag the fixed source commit.
- Replace pending external fields in `submission/metamask-directory.json` and `submission/ALLOWLIST_SUBMISSION.md`.
- Capture final listing screenshots from the audited build.
- Record the demo video from `DEMO_SCRIPT.md`.
- Capture real transaction fixtures in `submission/fixtures/`.
- Capture final E2E evidence in `submission/e2e/evidence.json`.
- Submit the MetaMask allowlist/directory request with the audit report, npm URL, public repo URL, source commits, demo video, support details, and listing assets.
- After allowlist approval, cut over frontend production configuration to the approved Snap ID and version range.
