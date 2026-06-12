# Ducat Snap Release Checklist

## Pre-Submission

- [ ] Public repository points to the audited source commit.
- [ ] `.github/workflows/verify.yml` succeeds on the audited source commit.
- [ ] `npm run verify:release` succeeds.
- [ ] `submission/metamask-directory.json` TODO fields are replaced.
- [ ] `npm run pack:dry-run` output reviewed.
- [ ] `npm run audit:prod` output reviewed.
- [ ] Dependency audit reviewed.
- [ ] Snapper/security scan reviewed.
- [ ] Console logs, unused permissions, TODOs, and dead RPC methods removed.
- [ ] Third-party audit completed because the Snap uses `snap_getBip32Entropy`.
- [ ] Audit fixes merged and tagged.

## Listing Assets

- [ ] Icon.
- [ ] `submission/screenshots/` contains final screenshots.
- [ ] Screenshots captured from the audited build using `LISTING.md`.
- [ ] Short description from `LISTING.md`.
- [ ] Long description from `LISTING.md`.
- [ ] Privacy policy.
- [ ] Support and escalation contact.
- [ ] Demo video recorded with `DEMO_SCRIPT.md`, showing install, connect, create/deposit/borrow/repay/withdraw/swap/liquidation signing, and Snap home.

## Publish

- [ ] Publish `@ducat-unit/ducat-snap` to npm.
- [ ] Submit MetaMask allowlist/directory request with:
  - [ ] audited commit
  - [ ] fixed commit
  - [ ] audit report
  - [ ] npm URL
  - [ ] public repo URL
  - [ ] demo video
  - [ ] support details
  - [ ] listing assets

## Production Cutover

- [ ] MetaMask allowlist approval received.
- [ ] Frontend production config uses `NEXT_PUBLIC_DUCAT_SNAP_ID=npm:@ducat-unit/ducat-snap`.
- [ ] Frontend production config uses the approved release range in `NEXT_PUBLIC_DUCAT_SNAP_VERSION`.
- [ ] Existing Xverse and UniSat regression flows pass.
- [ ] Signet/mutinynet install, connect, create, deposit, borrow, repay, withdraw, swap, and liquidation/repossess E2E scenarios pass.
