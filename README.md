# Ducat Snap

A MetaMask snap for Bitcoin accounts and signing in the [Ducat](https://ducatprotocol.com) protocol.

It derives Bitcoin accounts from the user's MetaMask Secret Recovery Phrase, keeps the keys
inside MetaMask, and exposes a small JSON-RPC API to the Ducat web app for message signing,
complete wallet inventory and PSBT signing. The web app drives everything the user does — borrow,
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
ducat_getNetwork()
ducat_getWalletInventory({ network })
ducat_signMessage({ network, address, message })
ducat_signPsbt({ network, psbt, signInputs, context })
ducat_signBatch({ network, entries, context })
ducat_switchNetwork({ network })
```

The Snap owns one explicit Bitcoin network selection. New installations default to
`mutinynet`. `ducat_getNetwork()` returns that selection; `ducat_switchNetwork()`
changes it only after a MetaMask-owned confirmation showing the requesting origin,
the From and To networks, the effective validator and Esplora origins, and the
signing-context warning. A same-network switch is a confirmation-free no-op.

Every network-sensitive method must exactly match the selected network. A mismatch
fails before account derivation, endpoint access, notifications, signing prompts, or
state mutation with `NETWORK_MISMATCH` details containing only `selectedNetwork` and
`requestedNetwork`. `features.explicitNetworkSelection` advertises this contract.
Legacy state with `lastNetwork` is migrated once to `selectedNetwork`; recent actions,
keys, endpoint overrides, and origin metadata are preserved.

Only the Ducat app origins below are allowed to call these:

```
https://app.ducatprotocol.com
https://dev.app.ducatprotocol.com
https://staging.app.ducatprotocol.com
```

`localhost` and preview deployments are intentionally not in the published manifest — a local
process or a hijacked preview subdomain should never be able to drive mainnet signing. For
local QA, build with the dev origins flag (`DUCAT_SNAP_DEV_ORIGINS`); those origins
are stripped from the published build. The infra `compose/ducat-snap.yml` default
dev origins include `http://localhost:3000` for the frontend and
`http://localhost:8075` for `ducat-admin`.

## Network Profiles and Endpoint Overrides

The Snap ships bundled network profiles in [`src/network-profiles.json`](src/network-profiles.json).
Each profile contains public validator and Esplora endpoints for one Bitcoin network.

Users can set validator and Esplora endpoint overrides from Snap Home. Overrides are
stored in Snap state and apply to complete wallet inventory and signing verification.
Dapps pass only
the target network name; they do not pass arbitrary endpoint URLs into signing or
inventory RPC calls. Remote overrides require HTTPS and are verified against the
selected Bitcoin network before they are stored. Plain HTTP is limited to regtest
loopback development.

Snap Home uses the same confirmed switch flow as website requests. Endpoint and key
forms re-read the selected network before changing network-scoped state, so a stale
Home screen cannot modify a different network.

## Development

```bash
npm ci
npm run build        # mm-snap build -> dist/bundle.js
npm run manifest     # regenerate the manifest shasum
npm run serve        # serve the snap at http://localhost:8080
```

The `ducat-infra` local stack uses `make snap-build` / `make snap-serve` to
generate and serve `.snap/dev`. Localhost origins and the development bundle
shasum are written only to that ignored runtime; the tracked manifest remains
the production HTTPS policy.

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
signed for (with a Snap Home imported-key override taking precedence when present), only the
explicit `signInputs` indexes are signed, and every signing path requires a
MetaMask confirmation. Frontend-supplied context is treated as untrusted display metadata — the
parsed PSBT plus fresh Snap-owned wallet/prevout evidence is the source of truth for what's actually
signed. Websites construct and broadcast transactions. Taproot vault inputs must carry a
Ducat cosign tapleaf whose control block recomputes to the prevout output key.

The third-party security audit (Sayfer) is in [`docs/audit.pdf`](docs/audit.pdf).

## License

See [LICENSE](LICENSE).
