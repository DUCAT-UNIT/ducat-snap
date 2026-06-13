# MetaMask Submission Package

This directory holds the local inputs for the MetaMask allowlist/directory submission.

Use `ALLOWLIST_SUBMISSION.md` as the working copy for the MetaMask form fields. Use `../AUDITOR_HANDOFF.md` and `../AUDIT_SCOPE.md` for the third-party audit packet.

Current audit candidate:

- Tag: `audit-candidate-0.1.0-20260614-fixture-replay`
- Commit: resolve from the tag with `git rev-list -n 1 audit-candidate-0.1.0-20260614-fixture-replay`
- Verification evidence: current checks on https://github.com/DUCAT-UNIT/ducat-snap/pull/1

## Before Submission

1. Track the remaining external fields in `EXTERNAL_GATES.md`.
2. Replace the remaining `PENDING_*` fields in `metamask-directory.json` and `ALLOWLIST_SUBMISSION.md`.
3. Capture real PSBT fixtures into `submission/fixtures/`, including the exact Snap `WalletAccountRecord` so fixture confirmations can be replayed without private keys.
4. Capture final E2E evidence into `submission/e2e/evidence.json`.
5. Capture screenshots into `submission/screenshots/` using `LISTING.md`.
6. Record the demo video using `DEMO_SCRIPT.md`.
7. Attach the third-party audit report required for `snap_getBip32Entropy`.
8. Confirm the audited and fixed commits are listed in the audit report.
9. Run `npm ci && npm run verify:release` from the repository root.
10. Publish `@ducat-unit/ducat-snap@0.1.0` to npm after audit fixes are merged.
11. Run `npm run verify:submission-ready` after npm publish, final screenshots, demo video, audit report, fixtures, E2E evidence, and pending fields are complete.

## Required External URLs

- Public GitHub repository URL.
- npm package URL.
- Audit report URL.
- Demo video URL.
- Published privacy policy URL if the packaged `PRIVACY.md` is not the canonical policy.
- Support/escalation contact URL or email.
