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
  "accounts": {
    "sats": {
      "address": "tb1q...",
      "pubkey": "33-byte-compressed-pubkey-hex"
    },
    "runes": {
      "address": "tb1p...",
      "pubkey": "32-byte-x-only-pubkey-hex"
    },
    "vault": {
      "address": "tb1p...",
      "pubkey": "32-byte-x-only-pubkey-hex"
    },
    "authCandidates": [
      {
        "address": "tb1q...",
        "publicKey": "33-byte-compressed-pubkey-hex",
        "addressType": "p2wpkh",
        "isPreferred": true
      }
    ]
  },
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
    "frontendOrigin": "https://app.ducatprotocol.com",
    "frontendCommit": "40-character-frontend-git-sha",
    "snapCommit": "40-character-snap-git-sha",
    "clientSdkVersion": "0.25.2",
    "validatorUrl": "https://validator.dev.ducatprotocol.com"
  }
}
```

`accounts` must be the exact `WalletAccountRecord` returned by the Snap during capture. `capturedFrom.snapCommit` must match the current audit candidate tag in `../metamask-directory.json`. The submission gate reconstructs output scripts from these public keys, parses the PSBT, renders the confirmation, and checks every `expectedConfirmationText` string against the current Snap UI. This keeps the final fixture corpus useful without committing private keys.

Do not commit private keys, seed phrases, browser profiles, cookies, access tokens, or unrelated transaction data. Re-capture every fixture if the audited Snap commit, frontend commit, client SDK version, validator behavior, package shasum, or manifest shasum changes.
