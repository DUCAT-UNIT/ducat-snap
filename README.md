# Ducat Snap

A MetaMask snap for Bitcoin accounts and signing in the [Ducat](https://ducatprotocol.com) protocol.

It derives Bitcoin accounts from the user's MetaMask Secret Recovery Phrase, keeps the keys
inside MetaMask, and exposes a small JSON-RPC API to the Ducat web app for message signing,
PSBT signing, and simple transfers. The web app drives everything the user does — borrow,
repay, withdraw, and so on — and the snap handles account discovery and the MetaMask
confirmation prompts.

> Mainnet, signet, and mutinynet are supported. Local development against regtest needs a
> dev build (see below).

## What are snaps?

Snaps let developers extend MetaMask with capabilities it doesn't ship by default — like
support for non-EVM chains. They run in an isolated environment with a limited set of
permissions. See the [MetaMask Snaps docs](https://docs.metamask.io/snaps/) for more.

## RPC methods

```
ducat_getAccounts({ network })
ducat_getCapabilities()
ducat_getHomeState({ network })
ducat_signMessage({ network, address, message })
ducat_signPsbt({ network, psbt, signInputs, context })
ducat_signBatch({ network, entries, context })
ducat_sendTransfer({ network, address, amountSats, feeRate })
ducat_clearRecentActions()
```

Only the Ducat app origins below are allowed to call these:

```
https://app.ducatprotocol.com
https://dev.app.ducatprotocol.com
https://staging.app.ducatprotocol.com
```

`localhost` and preview deployments are intentionally not in the published manifest — a local
process or a hijacked preview subdomain should never be able to drive mainnet signing. For
local QA, build with the dev origins/regtest flags (`DUCAT_SNAP_DEV_ORIGINS`,
`DUCAT_SNAP_DEV_REGTEST`); those are stripped from the published build.

## Development

```bash
npm ci
npm run build        # mm-snap build -> dist/bundle.js
npm run manifest     # regenerate the manifest shasum
npm run serve        # serve the snap at http://localhost:8080
```

Before opening a PR:

```bash
npm run type-check
npm test
npm run verify:harness   # MetaMask simulation harness (accounts, signing, BitVM3)
```

Point the frontend at the local build with `NEXT_PUBLIC_DUCAT_SNAP_ID="local:http://localhost:8080"`,
or at the published package with `NEXT_PUBLIC_DUCAT_SNAP_ID="npm:@ducat-unit/wallet-snap"`.

## Security

Keys, child keys, WIFs, and raw entropy never leave the snap. Only derived Ducat accounts are
signed for, only the explicit `signInputs` indexes are signed, and every signing path requires a
MetaMask confirmation. Frontend-supplied context is treated as untrusted display metadata — the
parsed PSBT is the source of truth for what's actually signed. Taproot vault inputs must carry a
Ducat cosign tapleaf whose control block recomputes to the prevout output key.

The third-party security audit (Sayfer) is in [`docs/audit.pdf`](docs/audit.pdf).

## FAQ

### What is the Ducat Snap?

The Ducat Snap is a MetaMask Snap that gives the Ducat web app a Bitcoin signing
interface for Ducat protocol actions. It derives the user's Ducat Bitcoin accounts inside
MetaMask, returns public account data to the app, and asks the user to approve every
message, PSBT, batch, or transfer before anything is signed.

### Why is a Snap needed if MetaMask already supports Bitcoin?

MetaMask native Bitcoin is useful for ordinary Bitcoin account management. Ducat needs a
Ducat-aware signer, not just a generic send-and-receive wallet. Vault actions require the
signer to understand Ducat account roles, explicit PSBT input ownership, Taproot
script-path vault inputs, guardian cosign leaves, BitVM3 timeout leaves, batch signing,
and confirmation text for actions such as create, deposit, borrow, repay, withdraw,
liquidate, and repossess.

The Snap provides that Ducat-specific validation and confirmation layer before asking
MetaMask to sign.

### Does the Snap derive the same Bitcoin account family as MetaMask native Bitcoin?

Yes. The current Snap requests BIP32 entropy for the BIP84 and BIP86 mainnet and testnet
coin types: `m/84'/0'`, `m/86'/0'`, `m/84'/1'`, and `m/86'/1'`.

On mainnet, the Snap derives:

```text
sats:  m/84'/0'/0'/0/0
runes: m/86'/0'/0'/0/0
vault: m/86'/0'/0'/0/1
```

Signet and mutinynet use the corresponding testnet coin type, `1'`.

This overlap is intentional in the current implementation. The important distinction is
that the Snap is not a general-purpose Bitcoin wallet replacement. It exposes only
Ducat-scoped RPC methods, and it signs only after validating Ducat ownership, PSBT
structure, network, script commitments, and user-visible confirmations.

### Why not use an isolated custom derivation path?

The current Ducat integration expects stable Bitcoin public keys and addresses for the
user's sats, runes, and vault roles. The vault account is not just another receive
address; it is the user key committed into Ducat Taproot vault scripts and timeout flows.
Changing these paths would be a protocol and migration decision, not a documentation-only
change, because the frontend, validator fixtures, existing accounts, and transaction
expectations would all need to agree on the new keys.

### Can Ducat use MetaMask native Bitcoin or Sats Connect instead?

Only if the native interface exposes the full signing surface Ducat requires. In
practice, Ducat needs usable public keys for the protocol roles, controlled PSBT input
selection, Taproot script-path signing, validation of Ducat cosign and timeout leaves,
batch signing, and Ducat-specific confirmation rendering. If MetaMask native Bitcoin later
provides equivalent APIs, Ducat can reduce or replace the Snap scope.

### What does the Snap sign?

- Ducat authentication messages using BIP322-style message signing.
- PSBT inputs explicitly requested by the Ducat app and owned by a derived Ducat role.
- Batch PSBT flows used by multi-transaction vault actions.
- Simple BTC transfers from the derived sats account.

### What does the Snap refuse to sign?

The Snap rejects malformed or oversized signing requests, wrong-network PSBTs, unknown
signing indexes, duplicate previous outputs, missing previous-output data, non-owned
inputs, mixed or ambiguous ownership, disallowed sighash types, suspicious data outputs,
malicious or malformed app context, and vault Taproot script-path inputs that do not
commit to recognized Ducat cosign or BitVM3 timeout leaves.

### What permissions does the Snap request?

- `snap_getBip32Entropy` to derive the Ducat Bitcoin accounts inside MetaMask.
- `snap_dialog` to show user confirmations before signing.
- `snap_manageState` to store non-secret Snap state such as recent activity.
- `snap_notify`, `endowment:page-home`, `endowment:network-access`, and
  `endowment:lifecycle-hooks` for user notifications, the Snap home screen, balance and
  vault lookups, and lifecycle handling.

Private keys, child keys, WIFs, and raw entropy are never returned to the web app.

### Which websites can call the Snap?

The published Snap allows only these HTTPS origins:

```text
https://app.ducatprotocol.com
https://dev.app.ducatprotocol.com
https://staging.app.ducatprotocol.com
```

Localhost and preview deployments are development-only and are not present in the
published manifest.

### Which networks are supported?

The published Snap supports Bitcoin mainnet, signet, and mutinynet. Regtest is available
only in development builds.

### How has the Snap been reviewed?

The Snap includes automated coverage for account derivation, message signing, PSBT
policy, vault action decoding, Snap home data handling, adversarial PSBT cases, release
manifest verification, and fixture replay. The third-party Sayfer audit report is
included in [`docs/audit.pdf`](docs/audit.pdf).

## License

See [LICENSE](LICENSE).
