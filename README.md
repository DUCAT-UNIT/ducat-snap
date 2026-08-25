# Ducat Snap

A MetaMask snap for Bitcoin accounts and signing in the [Ducat](https://ducatprotocol.com) protocol.

It derives Bitcoin accounts from the user's MetaMask Secret Recovery Phrase, keeps the keys
inside MetaMask, and exposes a small JSON-RPC API to the Ducat web app for message signing,
complete wallet inventory and PSBT signing. The web app drives everything the user does — borrow,
repay, withdraw, and so on — and the snap handles account discovery and the MetaMask
confirmation prompts.

The production artifact supports the `mainnet`, `signet`, `mutinynet`, and
`testnet4` deployments. The role-neutral local development artifact supports
those deployments plus `regtest` and `alpha-mainnet`.

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

The Snap owns one explicit deployment selection. New production installations default to
`mutinynet`. `ducat_getNetwork()` returns that selection; `ducat_switchNetwork()`
changes it only after a MetaMask-owned confirmation showing the requesting origin,
the From and To networks, the effective validator and Esplora origins, and the
signing-context warning. A same-network switch is a confirmation-free no-op.

Every deployment-sensitive method must exactly match the selected deployment. A mismatch
fails before account derivation, endpoint access, notifications, signing prompts, or
state mutation with `NETWORK_MISMATCH` details containing only `selectedNetwork` and
`requestedNetwork`. `features.explicitNetworkSelection` advertises this contract.
Legacy state with `lastNetwork` is migrated once to `selectedNetwork`; recent actions,
keys, endpoint overrides, and origin metadata are preserved.

The production artifact allows exactly these Ducat app origins:

```
https://app.ducatprotocol.com
https://dev.app.ducatprotocol.com
https://staging.app.ducatprotocol.com
```

`localhost` and preview deployments are intentionally absent from the published
manifest. The development artifact replaces this list with exactly
`http://localhost:3000`, `http://localhost:8075`, `http://frontend:3000`, and
`http://ducat-admin:8075`; it does not inherit production origins. It contains
exactly `regtest`, `signet`, `mutinynet`, `testnet4`, `alpha-mainnet`, and
`mainnet`, defaults to `mutinynet`, and disables debug and unprompted signing.
The test-only unprompted method refuses every deployment mapped to Bitcoin
mainnet before wallet state, endpoints, entropy, prompts, or signing are
touched. Ordinary signing remains prompted for every admitted deployment.

Infra builds the ignored development candidate under `.snap/dev`, gates it
while no server is running, and serves those frozen bytes only at
`local:http://localhost:8086`. Frontend and Admin are caller workflows of this
one local Snap; neither is an artifact-policy class. Production packaging stays
on the isolated production policy and contains no localhost or
`alpha-mainnet` authority.

From `ducat-infra`, use `make snap-down`, `make snap-install`, and
`make snap-check` before `make snap-serve`. Starting the Alpha-configured Admin
does not build, start, stop, or log the shared Snap. Snap install/update, key
import, funding, prompting, signing, and broadcast each remain separate
operator approvals. The complete real-Bitcoin sequence and private-key
handling rules are in
[`../../dev/runbooks/DUCAT_ADMIN_ALPHA_MAINNET.md`](../../dev/runbooks/DUCAT_ADMIN_ALPHA_MAINNET.md).

## Network Profiles and Endpoint Overrides

The Snap ships bundled network profiles in [`src/network-profiles.json`](src/network-profiles.json).
Each profile carries a distinct deployment ID plus the Bitcoin network used for
address, transaction, transport, and genesis mechanics. `alpha-mainnet` therefore
remains a distinct deployment identity even though it maps to Bitcoin mainnet.

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

The `ducat-infra` local stack uses `make snap-check` to generate and validate
`.snap/dev`, then `make snap-serve` to serve the unchanged candidate. Localhost
origins and the development bundle shasum are written only to that ignored
runtime; the tracked manifest remains the production HTTPS policy. Development preparation rejects missing, duplicate,
credential-bearing, path-bearing, query-bearing, fragment-bearing, and malformed
origin entries instead of extending the production list.

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
MetaMask confirmation in the production artifact. Frontend-supplied context is treated as untrusted display metadata — the
parsed PSBT plus fresh Snap-owned wallet/prevout evidence is the source of truth for what's actually
signed. Websites construct and broadcast transactions. Taproot vault inputs must carry a
Ducat cosign tapleaf whose control block recomputes to the prevout output key.

The third-party security audit (Sayfer) is in [`docs/audit.pdf`](docs/audit.pdf).

## License

See [LICENSE](LICENSE).
