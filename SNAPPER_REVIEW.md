# Snapper Review

Last local command:

```bash
npx --yes @sayfer_io/snapper --path . --output snapper-report.json
```

Local result: 242 findings (227 `ESLinting`, 11 `ExcessiveComments`, 4 `HardcodedSecrets`).

The count rose from 235 across the regtest/dev-tooling work: the additions are all risk-1/2 style findings — `ESLinting` missing-JSDoc `@param` notes and `ExcessiveComments` flags on the new dev-gate comment blocks (`src/debug.ts`, `src/networks.ts`). `HardcodedSecrets` stays at four (the same public guardian keys). The dev-only `regtest` network is now build-time gated behind `DUCAT_SNAP_DEV_REGTEST` (default off), so the published/audited bundle resolves to the three production networks only — its `http://localhost` esplora/validator endpoints and its unpinned-guardian path are dead-code-eliminated and `regtest` is rejected as an unknown network there.

The four `HardcodedSecrets` findings are Ducat guardian x-only **public** keys hardcoded per network in `src/networks.ts`: the shared guardian key (`ef8e6d84…ca2e`, flagged once per network) and the mutinynet BitVM FROST group key (`23586495…2321`). They are public keys intended to be embedded so the Snap can pin the vault cosigner identity; they are not secrets. The remaining findings are style/comment-density scanner policy, not signing, key-export, origin-authorization, confirmation-bypass, or network-scope findings.

## Addressed Findings

The first local scan reported 105 findings. The implementation now fixes the non-style/high-signal findings from that run:

- Removed an unused `Buffer` import.
- Replaced empty catch handling with explicit behavior.
- Removed duplicate taproot key update catch logic by validating `tapInternalKey` before signing.
- Removed an unused function parameter.
- Removed an unused type import introduced during the confirmation cleanup.
- Replaced `||` fallback logic with `??` where empty strings should remain meaningful.
- Removed the content-type false positive from the hardcoded-secret detector.

## Remaining Finding Summary

- 178 missing JSDoc comments.
- External API response fields using snake_case, such as Esplora and Ducat validator fields (`funded_txo_sum`, `spent_txo_sum`, `chain_stats`, `mempool_stats`, `asset_balance`, `unit_balance`, and vault summary fields).
- One object literal key using `vault_pubkey`, matching the Ducat validator API.
- One `hmac(sha512, ...)` style warning in local BIP32 derivation.

## Review Notes

The remaining findings should be reviewed by the external Snap auditor, but they are not currently treated as local release blockers because they are style or scanner-policy findings rather than signing, key-export, origin-authorization, confirmation-bypass, or network-scope findings.

The generated `snapper-report.json` is intentionally ignored and not included in the npm package because it contains machine-local absolute paths. Keep it with release evidence for the audited commit rather than committing it to the public source repository.
