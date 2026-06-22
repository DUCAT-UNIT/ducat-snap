# Ducat Snap Auditor Handoff

Date prepared: 2026-06-15

This document is the external security review handoff for `@ducat-unit/wallet-snap@0.1.9`. It complements `AUDIT_SCOPE.md`, `RELEASE_EVIDENCE.md`, `INTERNAL_SECURITY_REVIEW.md`, `SNAPPER_REVIEW.md`, and `DEPENDENCY_AUDIT.md`.

## Review Objective

Assess whether the Ducat Snap can safely derive mainnet, signet, and mutinynet Bitcoin accounts from MetaMask entropy and sign Ducat-requested messages, PSBTs, PSBT batches, and simple transfers without exposing private key material, mixing Bitcoin coin types, or allowing unauthorized signing.

## Candidate Source

- Public repository: https://github.com/DUCAT-UNIT/ducat-snap
- Audit candidate tag: `audit-candidate-0.1.9-20260617-release-0.1.9`
- Audit candidate commit: tag target for `audit-candidate-0.1.9-20260617-release-0.1.9`
- GitHub Actions verification: https://github.com/DUCAT-UNIT/ducat-snap/actions/workflows/verify.yml
- npm package name: `@ducat-unit/wallet-snap`
- npm package version: `0.1.9`
- npm URL: https://www.npmjs.com/package/@ducat-unit/wallet-snap
- Package dry-run shasum: `dac7837f131495042a1473620bf774ef24162cb7`
- Package dry-run integrity: `sha512-m9Gxz9vU99jrSfqKq4Qvfysbjq/JaaFo+3ESaPRwZLw2UcCSTx1sEDEt1Mrx4cQYvEX8BabruKcez2IO/2BUXQ==`
- Snap manifest source shasum: `0JTo/wc+J91UCeoxX0cLmuDuTdlEpmcMggIpWGGpWro=`
- Proposed Snap name: `Ducat`
- Intended launch scope: mainnet, signet, and mutinynet
- Mainnet support: enabled in this audit candidate and in scope for external review

Use this candidate unless the Ducat team provides a newer fixed-candidate tag after audit remediation.

## Required MetaMask Audit Coverage

The Snap requests `snap_getBip32Entropy`, so the review must cover:

- Snap source code that runs inside the Snaps execution environment.
- Local modules used for Bitcoin key derivation and signing.
- Package manifest permissions and allowed origins.
- Built bundle and release package produced by the documented verification commands.

The final report should identify:

- The commit or tag audited.
- The commit or tag containing fixes, if fixes are required.
- Every vulnerability found, including severity, impact, recommendation, and Ducat's fix or risk acceptance.
- Explicit confirmation that medium, high, and critical findings are fixed or otherwise accepted in a form MetaMask can review.

## Security Invariants To Verify

- No RPC method, error path, log path, state path, or UI path returns raw entropy, private keys, WIFs, or child private keys.
- The Snap derives Bitcoin mainnet paths `m/84'/0'` and `m/86'/0'`, plus testnet paths `m/84'/1'` and `m/86'/1'`.
- The Snap exposes mainnet, signet, and mutinynet account data and must not mix coin types, addresses, validator endpoints, or broadcast endpoints between those networks.
- `ducat_signPsbt` signs only input indexes explicitly listed in `signInputs`.
- `ducat_signPsbt` signs only inputs controlled by Snap-derived addresses.
- `ducat_signBatch` preserves request order and fails the full batch if any entry is unauthorized or malformed.
- `ducat_signMessage`, `ducat_signPsbt`, `ducat_signBatch`, and `ducat_sendTransfer` require MetaMask confirmation before signing or broadcasting.
- Confirmation UI displays origin, network, action context, signed input indexes, output summary, and fee when calculable.
- Friendly frontend context is treated as untrusted display metadata; parsed PSBT facts are the signing source of truth.
- Unauthorized origins cannot invoke the Snap RPC API.
- Network access is limited to public balance, vault, fee, UTXO, and broadcast behavior needed for mainnet, signet, and mutinynet Ducat flows.
- Snap state stores only recent Ducat action metadata needed for Snap Home.

## Suggested Review Commands

Run from the repository root:

```bash
npm ci
npm run type-check
npm test -- --runInBand
npm run build
npm run manifest
npm run verify:harness
npm run audit:prod
npm run snapper
npm run verify:release
```

## Manual Review Focus

- `snap.manifest.json` for permissions and origin scope.
- `src/bip32.ts`, `src/accounts.ts`, and `src/message.ts` for entropy handling and signing.
- `src/psbt.ts` for PSBT ownership checks, input index checks, network checks, Taproot script-path commitment checks, and Ducat vault sequence/OP_RETURN decoding.
- `src/rpc.ts` for origin validation, parameter validation, and method routing.
- `src/confirmations.ts` and `src/ui.ts` for confirmation clarity and safe rendering of arbitrary messages.
- `src/transfer.ts` and `src/home.ts` for network calls and state updates.
- `src/__tests__/` for the release test coverage baseline and submission fixture replay path.

## Known Pre-Audit Notes

- Production dependency audit is clean.
- Full `npm audit` reports development-toolchain findings from build/test dependencies; see `DEPENDENCY_AUDIT.md`.
- Snapper reports low-risk style/scanner-policy findings; see `SNAPPER_REVIEW.md`.
- Taproot script-path inputs must prove the supplied tapleaf commits to the prevout P2TR output key.
- Production support, escalation, and legal privacy URLs must be finalized before MetaMask directory submission.
