# MetaMask Submission Package

This directory holds the local inputs for the MetaMask allowlist/directory submission.

Use `ALLOWLIST_SUBMISSION.md` as the working copy for the MetaMask form fields. Use `../AUDITOR_HANDOFF.md` and `../AUDIT_SCOPE.md` for the third-party audit packet.

Current audit candidate:

- Tag: `audit-candidate-0.1.0-20260613-runtime-hygiene-guard`
- Commit: resolve from the tag with `git rev-list -n 1 audit-candidate-0.1.0-20260613-runtime-hygiene-guard`
- Verification evidence: current checks on https://github.com/DUCAT-UNIT/ducat-snap/pull/1

## Before Submission

1. Track the remaining external fields in `EXTERNAL_GATES.md`.
2. Replace the remaining `PENDING_*` fields in `metamask-directory.json` and `ALLOWLIST_SUBMISSION.md`.
3. Capture screenshots into `submission/screenshots/` using `LISTING.md`.
4. Record the demo video using `DEMO_SCRIPT.md`.
5. Attach the third-party audit report required for `snap_getBip32Entropy`.
6. Confirm the audited and fixed commits are listed in the audit report.
7. Run `npm ci && npm run verify:release` from the repository root.
8. Publish `@ducat-unit/ducat-snap@0.1.0` to npm after audit fixes are merged.

## Required External URLs

- Public GitHub repository URL.
- npm package URL.
- Audit report URL.
- Demo video URL.
- Published privacy policy URL if the packaged `PRIVACY.md` is not the canonical policy.
- Support/escalation contact URL or email.
