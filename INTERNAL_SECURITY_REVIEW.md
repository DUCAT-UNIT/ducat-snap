# Internal Security Review

Date: 2026-06-13

This is an internal pre-audit review for `@ducat-unit/wallet-snap@0.1.0`. It is not a substitute for the required third-party audit for `snap_getBip32Entropy`, but it documents the audit approach, reviewed attack surface, findings, and remediations before external handoff.

## Scope

- Snap RPC entrypoint and origin authorization.
- Testnet network gating and endpoint selection.
- BIP32 entropy handling and fixed account derivation.
- BIP322 message signing.
- PSBT parsing, summarization, confirmation, and signing.
- Batch signing behavior.
- Direct BTC transfer construction and broadcast.
- Snap state and Snap Home data display.
- Release and allowlist metadata consistency checks.

## Threat Model

- A malicious or compromised allowed origin attempts to trick the user into signing unexpected messages or transactions.
- A malicious PSBT attempts to obtain signatures for inputs not controlled by the Snap account, or for Taproot script paths that are not committed to the prevout.
- A network endpoint returns malformed or adversarial data for transfer construction or Snap Home display.
- A large request attempts to exhaust Snap execution time or memory.
- App-supplied context misrepresents a transaction while parsed PSBT facts differ.
- Release metadata drifts from the built bundle or npm package.

## Review Method

- Manual review of the runtime source modules under `src/`.
- Static scan using Snapper.
- Existing release gate: `npm run verify:release`.
- Focused regression tests for signing, RPC validation, and transfer UTXO handling.
- Release artifact and manifest consistency verification.

## Findings And Remediation

### F-001: Uncommitted Taproot Script-Path Inputs Were Accepted

Severity: High

The PSBT validator accepted a compatibility path where a Taproot script leaf contained the Ducat vault pubkey but could not be proven to commit to the prevout output key. This was useful for alpha PSBTs, but it is not audit-grade signing policy. A Snap should not sign a Taproot script-path input unless the provided tapleaf and control block recompute to the prevout P2TR output key.

Remediation:

- Removed the alpha compatibility acceptance path.
- Taproot script-path signing now requires an owned tapleaf that commits to the prevout output key.
- Added a regression test that rejects uncommitted vault script-path inputs.

### F-002: Message Signing Could Hide Content Beyond The Confirmation Preview

Severity: Medium

Message confirmations displayed only the first 800 characters while the Snap signed the full message. The confirmation included a fingerprint, but a user could still approve hidden message content.

Remediation:

- Added an 800-character hard limit for message signing requests.
- Overlong messages are rejected before entropy or confirmation.
- Added a regression test to ensure no Snap entropy request occurs for overlong messages.

### F-003: Batch Signing Had No Transaction Count Limit

Severity: Medium

Each PSBT had size and input/output caps, but the number of batch entries was not capped. A malicious allowed origin could request an oversized batch and force heavy parsing or an unreadable confirmation.

Remediation:

- Added a maximum of 10 PSBTs per batch request.
- Oversized batches are rejected before entropy or confirmation.
- Added a regression test for oversized batch rejection.

### F-004: Transfer Construction Trusted Network UTXO Shape

Severity: Medium

The direct BTC transfer path trusted Esplora UTXO response shape. Malformed `txid`, negative `vout`, zero or non-integer values, or excessive UTXO counts could cause poor failure modes after network fetch.

Remediation:

- Added explicit Esplora UTXO validation.
- Enforced 64-hex-character txids, safe integer non-negative `vout`, positive safe integer values, and a maximum of 80 UTXOs.
- Added transfer UTXO validation tests.

### F-005: Transfer Fee Rate Had No Upper Bound

Severity: Medium

An app-supplied or endpoint-supplied fee rate could be very high. The confirmation showed the fee, but direct broadcast should still bound fee policy in the Snap.

Remediation:

- Added a maximum transfer fee rate of 1,000 sat/vB.
- User-supplied fee rates outside the range are rejected.
- Endpoint estimates are capped to the same maximum.

### F-006: Release Metadata Drift Could Break CI Or Audit Evidence

Severity: Low

The release metadata verifier was missing the intentional `snap_notify` permission and release evidence had stale package and manifest hashes.

Remediation:

- Updated the metadata verifier permission set.
- Refreshed package shasum, package integrity, manifest shasum, and audit candidate tag references.
- Verified the new audit candidate tag resolves to the pushed commit.

### F-007: Vault OP_RETURN Decoder Did Not Match Current Core Payloads

Severity: Low

The confirmation parser still supported an older compact vault-return fixture, but current Ducat core vault return data encodes guardian indices, UNIT balance, price timestamp, and counted 93-byte oracle price commits. Valid signet/mutinynet vault transactions were therefore displayed with a decode warning instead of parsed after-state facts.

Remediation:

- Added current Ducat core OP_RETURN decoding for guardian index bytes and oracle price commit rows.
- Added vault action decoding from sequence metadata instead of trusting frontend labels for the action.
- Added explicit coverage for borrow, repay, repo, and liquidate/trim action codes.
- Preserved warning behavior for malformed Ducat-looking OP_RETURN outputs.
- Added regression tests for valid current core payloads and malformed Ducat-looking payloads.

## Residual Risk

- The Snap still depends on third-party APIs for balances, vault summaries, fee estimates, and transfer broadcast. Transfer signing does not trust those APIs for private keys, but availability and data quality remain external dependencies.
- Direct `ducat_sendTransfer` broadcasts after confirmation. This is intentional, but should receive extra external-audit attention because it combines signing and network submission.
- Snapper currently reports low-risk lint-policy findings only. These should be reviewed by the external auditor, but they are not treated as blockers because they are not key-export, origin-bypass, signing-policy, or network-scope findings.
- Mainnet remains disabled and should require a separate delta audit.

## External Audit Handoff Notes

Auditors should prioritize:

- BIP32 derivation isolation and absence of key export paths.
- Taproot script-path verification and PSBT signing policy.
- Whether BIP322 signing can be abused as a generic signing oracle.
- Confirmation UI correctness versus parsed PSBT facts.
- Origin allowlist and network-scope restrictions.
- Direct transfer fee policy, UTXO validation, and broadcast failure handling.
- Batch-signing all-or-nothing behavior.
