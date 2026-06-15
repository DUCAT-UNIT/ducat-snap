# Final E2E Evidence

Create `evidence.json` in this directory after recording the final mainnet/signet/mutinynet E2E pass against the audited Snap candidate.

Required scenario names:

- `install`
- `update`
- `connect`
- `reload-reconnect`
- `create`
- `deposit`
- `borrow`
- `repay`
- `withdraw`
- `swap`
- `liquidation`
- `repossess`
- `reject-signature`
- `disable-reenable`

Use this shape:

```json
{
  "network": "mutinynet",
  "snapCandidateTag": "audit-candidate-0.1.5-20260615-audit-confirmation-hardening",
  "snapCommit": "tag target for audit-candidate-0.1.5-20260615-audit-confirmation-hardening",
  "frontendCommit": "40-character-frontend-git-sha",
  "packageShasum": "published-npm-package-shasum",
  "packageIntegrity": "published-npm-package-integrity",
  "manifestSourceShasum": "RE0s+LP6Soq0Xn0R8P+DA2ChhPOB2pasPp9BsJng5/Y=",
  "demoVideoUrl": "https://...",
  "scenarios": [
    {
      "name": "install",
      "status": "passed",
      "evidence": "video timestamp 00:00-00:35"
    }
  ]
}
```

The `npm run verify:submission-ready` gate requires the Snap tag, Snap commit, package shasum, package integrity, manifest shasum, and demo video URL to match `../metamask-directory.json`. Every scenario must have `status: "passed"` and a non-empty evidence string. Re-run and update this evidence if the audited Snap commit, package shasum, package integrity, manifest shasum, frontend Snap ID, or frontend commit changes.

Do not add extra files to this directory. The submission gate only allows this README and `evidence.json`.
