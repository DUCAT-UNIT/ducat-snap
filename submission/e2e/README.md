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
  "frontendCommit": "git-sha",
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

The `npm run verify:submission-ready` gate requires every scenario to have `status: "passed"` and a non-empty evidence string. Re-run and update this evidence if the audited Snap commit, package shasum, manifest shasum, frontend Snap ID, or frontend commit changes.
