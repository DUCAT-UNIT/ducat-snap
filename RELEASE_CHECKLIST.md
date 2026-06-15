# Ducat Snap Release Checklist

## Completed For `0.1.5`

- [x] Public repository contains the audit-candidate source tag.
- [x] Audit candidate tag exists after the final handoff commit: `audit-candidate-0.1.5-20260615-https-origins`.
- [ ] `.github/workflows/verify.yml` succeeds on the current audit candidate.
- [x] `npm run verify:release` succeeds locally.
- [x] `npm run pack:dry-run` output reviewed.
- [x] `npm run audit:prod` output reviewed.
- [x] Dependency audit reviewed.
- [x] Snapper/security scan reviewed.
- [x] Console logs, unused permissions, accidental placeholders, and dead RPC methods removed or documented as external gates.
- [x] Legacy Taproot script-path compatibility behavior removed and replaced with committed tapleaf verification.
- [x] Deterministic MetaMask simulation harness covers account derivation and owned P2WPKH PSBT signing.
- [x] Mainnet derivation, network parsing, endpoint selection, and release metadata added to the audit candidate.
- [x] `@ducat-unit/wallet-snap@0.1.5` release metadata prepared for audit handoff.
- [ ] Frontend PR #675 default Snap version range updated to `^0.1.5`.

## Required Before MetaMask Submission

- [ ] Third-party audit completed because the Snap uses `snap_getBip32Entropy`.
- [ ] Audit fixes merged and tagged, if the audit requires fixes.
- [ ] `submission/metamask-directory.json` pending external fields are replaced.
- [ ] `submission/ALLOWLIST_SUBMISSION.md` pending external fields are replaced.
- [ ] Real create/deposit/borrow/repay/withdraw/swap/liquidation/repossess PSBT fixtures captured in `submission/fixtures/`.
- [ ] Final mainnet/signet/mutinynet E2E evidence captured in `submission/e2e/evidence.json`.
- [ ] Final screenshots captured in `submission/screenshots/`.
- [ ] Demo video recorded with `DEMO_SCRIPT.md`.
- [ ] Production support, escalation, and response-time details finalized.
- [ ] `npm run verify:submission-ready` succeeds after external evidence is complete.

## Listing Assets

- [x] Icon: `images/icon.svg`.
- [x] Short description from `LISTING.md`.
- [x] Long description from `LISTING.md`.
- [x] Privacy policy source: `PRIVACY.md`.
- [x] Security disclosure source: `SECURITY.md`.
- [x] Support source: `SUPPORT.md`.
- [ ] Final PNG screenshots captured from the audited build.
- [ ] Demo video recorded from the audited build.
- [ ] Support and escalation contact copied into the submission form.

## Submission

- [ ] Submit MetaMask allowlist/directory request with the audited commit, fixed commit if any, audit report, npm URL, public repository URL, demo video, support details, and listing assets.
- [ ] MetaMask allowlist approval received.

## Production Cutover

- [ ] Frontend production config uses `NEXT_PUBLIC_DUCAT_SNAP_ID=npm:@ducat-unit/wallet-snap`.
- [ ] Frontend production config uses the approved release range in `NEXT_PUBLIC_DUCAT_SNAP_VERSION`.
- [ ] Existing Xverse and UniSat regression flows pass.
- [ ] Mainnet/signet/mutinynet install, connect, create, deposit, borrow, repay, withdraw, swap, liquidation, and repossess E2E scenarios pass.
