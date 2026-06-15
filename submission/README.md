# MetaMask Submission Package

This directory holds the local inputs for the MetaMask allowlist/directory submission.

Use `ALLOWLIST_SUBMISSION.md` as the working copy for the MetaMask form fields. Use `../AUDITOR_HANDOFF.md` and `../AUDIT_SCOPE.md` for the third-party audit packet.

Current audit candidate:

- Tag: `audit-candidate-0.1.5-20260615-mainnet-support`
- Commit: tag target for `audit-candidate-0.1.5-20260615-mainnet-support`
- Package: `@ducat-unit/wallet-snap@0.1.5`
- npm URL: https://www.npmjs.com/package/@ducat-unit/wallet-snap
- GitHub verification: https://github.com/DUCAT-UNIT/ducat-snap/actions/workflows/verify.yml

## Before Submission

1. Track the remaining external fields in `EXTERNAL_GATES.md`.
2. Replace the remaining `PENDING_*` fields in `metamask-directory.json` and `ALLOWLIST_SUBMISSION.md`.
3. Attach the third-party audit report required for `snap_getBip32Entropy`.
4. Confirm the audited and fixed commits are listed in the audit report.
5. Capture real PSBT fixtures into `submission/fixtures/`, including the exact Snap `WalletAccountRecord` so fixture confirmations can be replayed without private keys.
6. Capture final E2E evidence into `submission/e2e/evidence.json`.
7. Capture screenshots into `submission/screenshots/` using `LISTING.md`.
8. Record the demo video using `DEMO_SCRIPT.md`.
9. Run `npm ci && npm run verify:release` from the repository root.
10. Run `npm run verify:submission-ready` after screenshots, demo video, audit report, fixtures, E2E evidence, and pending fields are complete.

The submission verifier rejects unexpected files in `submission/fixtures/`, `submission/screenshots/`, and `submission/e2e/`. Keep raw browser profiles, logs, private capture notes, and temporary exports outside this repository.

## Required External URLs

- Public GitHub repository URL.
- npm package URL.
- Audit report URL.
- Demo video URL.
- Published privacy policy URL if the packaged `PRIVACY.md` is not the canonical policy.
- Support and escalation contact URL or email.
