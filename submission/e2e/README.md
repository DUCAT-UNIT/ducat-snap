# Final E2E Evidence

Create `evidence.json` in this directory after recording the final signet/mutinynet E2E pass against the audited Snap candidate.

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
  "snapCandidateTag": "audit-candidate-0.1.0-YYYYMMDD-final",
  "snapCommit": "40-character-snap-git-sha",
  "frontendCommit": "40-character-frontend-git-sha",
  "packageShasum": "published-npm-package-shasum",
  "packageIntegrity": "published-npm-package-integrity",
  "manifestSourceShasum": "snap-manifest-source-shasum",
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
