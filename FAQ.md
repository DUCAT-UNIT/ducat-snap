# Ducat Snap FAQ

## What is the Ducat Snap?

The Ducat Snap is a MetaMask Snap that gives the Ducat web app a Bitcoin signing
interface for Ducat protocol actions. It derives the user's Ducat Bitcoin accounts inside
MetaMask, returns public account data to the app, and asks the user to approve every
message, PSBT, batch, or transfer before anything is signed.

## Why is a Snap needed if MetaMask already supports Bitcoin?

MetaMask native Bitcoin is useful for ordinary Bitcoin account management. Ducat needs a
Ducat-aware signer, not just a generic send-and-receive wallet. Vault actions require the
signer to understand Ducat account roles, explicit PSBT input ownership, Taproot
script-path vault inputs, guardian cosign leaves, BitVM3 timeout leaves, batch signing,
and confirmation text for actions such as create, deposit, borrow, repay, withdraw,
liquidate, and repossess.

The Snap provides that Ducat-specific validation and confirmation layer before asking
MetaMask to sign.

## Does the Snap derive the same Bitcoin account family as MetaMask native Bitcoin?

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

## Why not use an isolated custom derivation path?

The current Ducat integration expects stable Bitcoin public keys and addresses for the
user's sats, runes, and vault roles. The vault account is not just another receive
address; it is the user key committed into Ducat Taproot vault scripts and timeout flows.
Changing these paths would be a protocol and migration decision, not a documentation-only
change, because the frontend, validator fixtures, existing accounts, and transaction
expectations would all need to agree on the new keys.

## Can Ducat use MetaMask native Bitcoin or Sats Connect instead?

Only if the native interface exposes the full signing surface Ducat requires. In
practice, Ducat needs usable public keys for the protocol roles, controlled PSBT input
selection, Taproot script-path signing, validation of Ducat cosign and timeout leaves,
batch signing, and Ducat-specific confirmation rendering. If MetaMask native Bitcoin later
provides equivalent APIs, Ducat can reduce or replace the Snap scope. The current Bitcoin
Snap and other Bitcoin Snaps available today do not provide this Ducat-specific signing
and validation surface.

## What does the Snap sign?

- Ducat authentication messages using BIP322-style message signing.
- PSBT inputs explicitly requested by the Ducat app and owned by a derived Ducat role.
- Batch PSBT flows used by multi-transaction vault actions.
- Simple BTC transfers from the derived sats account.

## What does the Snap refuse to sign?

The Snap rejects malformed or oversized signing requests, wrong-network PSBTs, unknown
signing indexes, duplicate previous outputs, missing previous-output data, non-owned
inputs, mixed or ambiguous ownership, disallowed sighash types, suspicious data outputs,
malicious or malformed app context, and vault Taproot script-path inputs that do not
commit to recognized Ducat cosign or BitVM3 timeout leaves.

## What permissions does the Snap request?

- `snap_getBip32Entropy` to derive the Ducat Bitcoin accounts inside MetaMask.
- `snap_dialog` to show user confirmations before signing.
- `snap_manageState` to store non-secret Snap state such as recent activity.
- `snap_notify`, `endowment:page-home`, `endowment:network-access`, and
  `endowment:lifecycle-hooks` for user notifications, the Snap home screen, balance and
  vault lookups, and lifecycle handling.

Private keys, child keys, WIFs, and raw entropy are never returned to the web app.

## Which websites can call the Snap?

The published Snap allows only these HTTPS origins:

```text
https://app.ducatprotocol.com
https://dev.app.ducatprotocol.com
https://staging.app.ducatprotocol.com
```

Localhost and preview deployments are development-only and are not present in the
published manifest.

## Which networks are supported?

The published Snap supports Bitcoin mainnet, signet, and mutinynet. Regtest is available
only in development builds.

## How has the Snap been reviewed?

The Snap includes automated coverage for account derivation, message signing, PSBT
policy, vault action decoding, Snap home data handling, adversarial PSBT cases, release
manifest verification, and fixture replay. The third-party Sayfer audit report is
included in [`docs/audit.pdf`](docs/audit.pdf).
