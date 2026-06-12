# Snapper Review

Last local command:

```bash
npx --yes @sayfer_io/snapper --path . --output snapper-report.json
```

Local result: 100 findings, all under the `ESLinting` category.

## Addressed Findings

The first local scan reported 105 findings. The implementation now fixes the non-style/high-signal findings from that run:

- Removed an unused `Buffer` import.
- Replaced empty catch handling with explicit behavior.
- Removed duplicate taproot key update catch logic by validating `tapInternalKey` before signing.
- Removed an unused function parameter.
- Replaced `||` fallback logic with `??` where empty strings should remain meaningful.
- Removed the content-type false positive from the hardcoded-secret detector.

## Remaining Finding Summary

- 72 missing JSDoc comments.
- 6 missing explicit return type annotations.
- 4 generic type parameter naming warnings.
- External API response fields using snake_case, such as Esplora and Ducat validator fields.
- One `hmac(sha512, ...)` style warning in local BIP32 derivation.
- One type assertion warning.

## Review Notes

The remaining findings should be reviewed by the external Snap auditor, but they are not currently treated as local release blockers because they are style or scanner-policy findings rather than signing, key-export, origin-authorization, confirmation-bypass, or network-scope findings.

The generated `snapper-report.json` is intentionally ignored and not included in the npm package because it contains machine-local absolute paths. Keep it with release evidence for the audited commit rather than committing it to the public source repository.
