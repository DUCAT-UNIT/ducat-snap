# Ducat Snap Release Checklist

## Pre-Submission

- [x] Public repository contains the current audit-candidate source commit.
- [x] `.github/workflows/verify.yml` succeeds on the current audit candidate.
- [x] `npm run verify:release` succeeds locally.
- [ ] `submission/metamask-directory.json` pending external fields are replaced.
- [ ] `npm run verify:submission-ready` succeeds after external evidence is complete.
- [x] `npm run pack:dry-run` output reviewed.
- [x] `npm run audit:prod` output reviewed.
- [x] Dependency audit reviewed.
- [x] Snapper/security scan reviewed.
- [x] Console logs, unused permissions, accidental placeholders, and dead RPC methods removed or documented as external gates.
- [x] Alpha Taproot script-path compatibility fallback in `src/psbt.ts` was removed and replaced with committed tapleaf verification.
- [ ] Real create/deposit/borrow/repay/withdraw/swap/liquidation/repossess PSBT fixtures captured in `submission/fixtures/`.
- [ ] Final signet/mutinynet E2E evidence captured in `submission/e2e/evidence.json`.
- [ ] Third-party audit completed because the Snap uses `snap_getBip32Entropy`.
- [ ] Audit fixes merged and tagged.

## Listing Assets

- [x] Icon.
- [ ] `submission/screenshots/` contains final screenshots.
- [ ] Screenshots captured from the audited build using `LISTING.md`.
- [x] Short description from `LISTING.md`.
- [x] Long description from `LISTING.md`.
- [x] Privacy policy.
- [ ] Support and escalation contact.
- [ ] Demo video recorded with `DEMO_SCRIPT.md`, showing install, connect, create/deposit/borrow/repay/withdraw/swap/liquidation signing, and Snap home.

## Publish

- [ ] Publish `@ducat-unit/wallet-snap` to npm.
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
- [ ] Frontend production config uses `NEXT_PUBLIC_DUCAT_SNAP_ID=npm:@ducat-unit/wallet-snap`.
- [ ] Frontend production config uses the approved release range in `NEXT_PUBLIC_DUCAT_SNAP_VERSION`.
- [ ] Existing Xverse and UniSat regression flows pass.
- [ ] Signet/mutinynet install, connect, create, deposit, borrow, repay, withdraw, swap, and liquidation/repossess E2E scenarios pass.
