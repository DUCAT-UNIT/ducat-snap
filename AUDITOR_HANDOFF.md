# Ducat Snap Auditor Handoff

Date prepared: 2026-06-14

This document is the external security review handoff for `@ducat-unit/wallet-snap` v0.1.0. It complements `AUDIT_SCOPE.md`, `RELEASE_EVIDENCE.md`, `SNAPPER_REVIEW.md`, and `DEPENDENCY_AUDIT.md`.

## Review Objective

Assess whether the Ducat Snap can safely derive signet/mutinynet Bitcoin accounts from MetaMask entropy and sign Ducat-requested messages, PSBTs, PSBT batches, and simple transfers without exposing private key material or allowing unauthorized signing.

## Candidate Source

- Public repository: https://github.com/DUCAT-UNIT/ducat-snap
- Audit candidate tag: `audit-candidate-0.1.0-20260614-home-validator-audit-gate`
- Audit candidate commit: resolve from the tag with `git rev-list -n 1 audit-candidate-0.1.0-20260614-home-validator-audit-gate`
- GitHub Actions verification: see the current checks on https://github.com/DUCAT-UNIT/ducat-snap/pull/3
- npm package name: `@ducat-unit/wallet-snap`
- Package version: `0.1.0`
- Package dry-run shasum: `878a096d9b609b58ce68b50b63251344503fa625`
- Package dry-run integrity: `sha512-qlhxKWOFV2KOabCCEe43DKzEuxkKzsnSNwaj/VeQLOZgpk2sdd6rc93/nNe04R+syvH+WSJWqbpPrjnFfwwB3w==`
- Snap manifest source shasum: `GuB4R05SU6S0clWaBGipvm+JRTb28DuI9OV21X06WMY=`
- Proposed Snap name: `Ducat`
- Intended launch scope: signet/mutinynet only
- Mainnet support: intentionally out of scope for v0.1.0

Use the candidate above unless the Ducat team provides a newer fixed-candidate tag.

## Required MetaMask Audit Coverage

The Snap requests `snap_getBip32Entropy`, so the review must cover:

- The Snap source code that runs inside the Snaps execution environment.
- All local modules used for Bitcoin key derivation and signing.
- Package manifest permissions and allowed origins.
- The built bundle and release package produced by the documented verification commands.

The final report must identify:

- The commit or tag that was audited.
- The commit or tag containing fixes, if any fixes are required.
- Every vulnerability found, including severity, impact, recommendation, and Ducat's fix or risk acceptance.
- Explicit confirmation that medium, high, and critical findings are fixed or otherwise accepted in a way MetaMask can review.

## Security Invariants To Verify

- No RPC method, error path, log path, state path, or UI path returns raw entropy, private keys, WIFs, or child private keys.
- The Snap derives only testnet Bitcoin paths for v0.1.0: `m/84'/1'` and `m/86'/1'`.
- The Snap exposes only signet/mutinynet account data and rejects mainnet requests.
- `ducat_signPsbt` signs only input indexes explicitly listed in `signInputs`.
- `ducat_signPsbt` signs only inputs controlled by Snap-derived addresses.
- `ducat_signBatch` preserves request order and fails the full batch if any entry is unauthorized or malformed.
- `ducat_signMessage`, `ducat_signPsbt`, `ducat_signBatch`, and `ducat_sendTransfer` require MetaMask confirmation before signing or broadcasting.
- Confirmation UI displays origin, network, action context, signed input indexes, output summary, and fee when calculable.
- Friendly frontend context is treated as untrusted display metadata; parsed PSBT facts are the signing source of truth.
- Unauthorized origins cannot invoke the Snap RPC API.
- Network access is limited to the public balance, vault, fee, UTXO, and broadcast behavior needed for v0.1.0.
- Snap state stores only recent Ducat action metadata needed for Snap home.

## Suggested Review Commands

Run from the repository root:

```bash
npm ci
npm run type-check
npm test
npm run build
npm run manifest
npm audit
npm run audit:prod
npm run snapper
npm pack --dry-run
```

The release gate command is:

```bash
npm run verify:release
```

## Manual Review Focus

- `snap.manifest.json` for minimal permissions and origin caveats.
- `src/bip32.ts`, `src/accounts.ts`, and `src/message.ts` for entropy handling and signing.
- `src/psbt.ts` for PSBT ownership checks, input index checks, network checks, Taproot script-path commitment checks, and Ducat vault sequence/OP_RETURN decoding.
- `src/rpc.ts` for origin validation, parameter validation, and method routing.
- `src/confirmations.ts` and `src/ui.ts` for confirmation clarity and safe rendering of arbitrary messages.
- `src/transfer.ts` and `src/home.ts` for network calls and state updates.
- `src/__tests__/` for the release test coverage baseline, including submission fixture replay against captured PSBT confirmation text once final fixtures are present.

## Known Pre-Audit Notes

- Production dependency audit is clean.
- Full `npm audit` still reports development-toolchain findings from build/test dependencies; see `DEPENDENCY_AUDIT.md`.
- Snapper currently reports style/scanner-policy findings; see `SNAPPER_REVIEW.md`.
- Taproot script-path inputs must prove the provided tapleaf commits to the prevout P2TR output key. Include this commitment check in manual review before any mainnet expansion.
- The package is not yet published to npm until npm authentication is configured.
- Production support and legal privacy URLs must be finalized before MetaMask directory submission.
