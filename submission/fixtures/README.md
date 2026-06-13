# Real Transaction Fixture Capture

Place one real client-sdk/validator PSBT fixture per required Ducat flow in this directory before MetaMask submission.

Required files:

- `create.json`
- `deposit.json`
- `borrow.json`
- `repay.json`
- `withdraw.json`
- `swap.json`
- `liquidation.json`
- `repossess.json`

Each file must be captured from the audited Snap candidate and the frontend/client-sdk version used for final E2E. Use this shape:

```json
{
  "action": "deposit",
  "network": "mutinynet",
  "psbt": "cHNidP...",
  "signInputs": {
    "tb1q...": [0]
  },
  "expectedConfirmationText": [
    "Deposit BTC",
    "Vault update",
    "Approval summary"
  ],
  "capturedFrom": {
    "frontendCommit": "git-sha",
    "snapCommit": "git-sha",
    "clientSdkVersion": "0.25.2",
    "validatorUrl": "https://validator.dev.ducatprotocol.com"
  }
}
```

Do not commit private keys, seed phrases, browser profiles, cookies, access tokens, or unrelated transaction data. Re-capture every fixture if the audited Snap commit, frontend commit, client SDK version, validator behavior, package shasum, or manifest shasum changes.
