# MetaMask Submission Package

This directory holds the local inputs for the MetaMask allowlist/directory submission.

## Before Submission

1. Replace the `TODO` fields in `metamask-directory.json`.
2. Capture screenshots into `submission/screenshots/` using `LISTING.md`.
3. Record the demo video using `DEMO_SCRIPT.md`.
4. Attach the third-party audit report required for `snap_getBip32Entropy`.
5. Run `npm ci && npm run verify:release` from the repository root.
6. Publish `@ducat-unit/ducat-snap@0.1.0` to npm after audit fixes are merged.

## Required External URLs

- Public GitHub repository URL.
- npm package URL.
- Audit report URL.
- Demo video URL.
- Published privacy policy URL if the packaged `PRIVACY.md` is not the canonical policy.
- Support/escalation contact URL or email.
