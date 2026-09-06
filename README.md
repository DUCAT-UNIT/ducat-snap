# Ducat Snap

A MetaMask snap for Bitcoin accounts and signing in the
[Ducat](https://ducatprotocol.com) protocol.

It derives Bitcoin accounts from the user's MetaMask Secret Recovery Phrase,
keeps the keys inside MetaMask, and exposes a small JSON-RPC API to the Ducat
web app for message signing, complete wallet inventory and PSBT signing. The
web app drives everything the user does — borrow, repay, withdraw, and so on —
and the snap handles account discovery and the MetaMask confirmation prompts.

The production artifact supports exactly `mainnet` and `mutinynet`. The
role-neutral local development artifact adds `regtest`. The Snap has no
separate `alpha-mainnet` wallet network: its Mainnet profile currently uses
the reviewed alpha DUCAT contract while retaining canonical Bitcoin mainnet
address, transaction, and genesis rules.

## What are snaps?

Snaps let developers extend MetaMask with capabilities it doesn't ship by
default — like support for non-EVM chains. They run in an isolated environment
with a limited set of permissions. See the
[MetaMask Snaps docs](https://docs.metamask.io/snaps/) for more.

## RPC methods

```text
ducat_getAccounts({ network })
ducat_getCapabilities()
ducat_getNetwork()
ducat_getWalletInventory({ network })
ducat_signMessage({ network, address, message })
ducat_signPsbt({ network, psbt, signInputs, context })
ducat_signBatch({ network, entries, context })
ducat_switchNetwork({ network })
```

`ducat_getCapabilities()` reports `derivationScheme: "ducat-snap/v1"`. The
Snap requests the three final managed role nodes directly: sats at
`m/84'/<coin>'/0'/0/0`, UNIT at `m/86'/<coin>'/0'/0/0`, and vault at
`m/86'/<coin>'/0'/2/0`, where `<coin>` is `0` on Mainnet and `1` on Mutinynet
and Regtest. Ducat reserves role branch `2` for the vault client key; standard
branch `1` remains available for Bitcoin change addresses. Reinstalling
MetaMask from the same Secret Recovery Phrase recovers the same managed
accounts for this scheme. An imported key selected in Snap Home is an explicit
override and is not derived from this scheme.

The Snap owns one explicit deployment selection. New production installations
default to `mutinynet`. `ducat_getNetwork()` returns that selection;
`ducat_switchNetwork()` changes it only after a MetaMask-owned confirmation
showing the requesting origin, the From and To networks, the effective
validator and Esplora origins, and the signing-context warning. A same-network
switch is a confirmation-free no-op.

Every deployment-sensitive method must exactly match the selected deployment.
A mismatch fails before account derivation, endpoint access, notifications,
signing prompts, or state mutation with `NETWORK_MISMATCH` details containing
only `selectedNetwork` and `requestedNetwork`.
`features.explicitNetworkSelection` advertises this contract. Legacy state
with `lastNetwork` is migrated once to `selectedNetwork`; recent actions,
keys, endpoint overrides, and origin metadata for supported networks are
preserved. State belonging to removed `alpha-mainnet`, Signet, or Testnet4
Snap networks is discarded rather than renamed or migrated into Mainnet.

The production artifact allows exactly these Ducat app origins:

```text
https://app.ducatprotocol.com
https://dev.app.ducatprotocol.com
https://staging.app.ducatprotocol.com
```

`localhost` and preview deployments are intentionally absent from the
published manifest. The development artifact replaces this list with exactly
`http://localhost:3000`, `http://localhost:8075`, `http://frontend:3000`, and
`http://ducat-admin:8075`; it does not inherit production origins. It contains
exactly `regtest`, `mainnet`, and `mutinynet`, defaults to `mutinynet`, and
disables debug and unprompted signing. The test-only unprompted method refuses
every deployment mapped to Bitcoin mainnet before wallet state, endpoints,
entropy, prompts, or signing are touched. Ordinary signing remains prompted
for every admitted deployment.

Infra builds the ignored development candidate under `.snap/dev`, gates it
while no server is running, and serves those frozen bytes only at
`local:http://localhost:8086`. Frontend and Admin are caller workflows of this
one local Snap; neither is an artifact-policy class. Production packaging
stays on the isolated production policy and contains no localhost or removed
wallet network authority. The string `alpha-mainnet` remains only as the
Mainnet profile's expected validator response while the alpha DUCAT contract
is active.

From `ducat-infra`, use `make snap-down`, `make snap-install`, and
`make snap-check` before `make snap-serve`. Starting the Alpha-configured
Admin does not build, start, stop, or log the shared Snap. Snap
install/update, key import, funding, prompting, signing, and broadcast each
remain separate operator approvals. The complete real-Bitcoin sequence and
private-key handling rules are in
[`../../dev/runbooks/DUCAT_ADMIN_ALPHA_MAINNET.md`](../../dev/runbooks/DUCAT_ADMIN_ALPHA_MAINNET.md).

## Network Profiles and Endpoint Overrides

The Snap ships bundled network profiles in
[`src/network-profiles.json`](src/network-profiles.json). Each profile carries
a canonical Snap network, the Bitcoin network used for address, transaction,
transport, and genesis mechanics, and the exact `chain_network` value expected
from its validator. The Mainnet profile currently expects `alpha-mainnet`;
that value is contract-stage evidence, not another Snap network. Retiring the
alpha contract requires changing the profile expectation and validator URL,
not adding or migrating a wallet network.

Users can set validator and Esplora endpoint overrides from Snap Home.
Overrides are stored in Snap state and apply to complete wallet inventory and
signing verification. Dapps pass only the target network name; they do not
pass arbitrary endpoint URLs into signing or inventory RPC calls. Remote
overrides require HTTPS and are verified against the selected Bitcoin network
before they are stored. An override changes only the URL; it cannot change the
profile's expected validator identity. Plain HTTP is limited to regtest
loopback development.

Snap Home uses the same confirmed switch flow as website requests. Endpoint
and key forms re-read the selected network before changing network-scoped
state, so a stale Home screen cannot modify a different network.

## Development

```bash
npm ci
npm run build        # mm-snap build -> dist/bundle.js
npm run manifest     # regenerate the manifest shasum
npm run serve        # serve the snap at http://localhost:8080
```

The `ducat-infra` local stack uses `make snap-check` to generate and validate
`.snap/dev`, then `make snap-serve` to serve the unchanged candidate.
Localhost origins and the development bundle shasum are written only to that
ignored runtime; the tracked manifest remains the production HTTPS policy.
Development preparation rejects missing, duplicate, credential-bearing,
path-bearing, query-bearing, fragment-bearing, and malformed origin entries
instead of extending the production list.

Before opening a PR:

```bash
npm run type-check
npm test
# MetaMask simulation harness (accounts, signing, BitVM3)
npm run verify:harness
```

Point the frontend at the local build with
`NEXT_PUBLIC_DUCAT_SNAP_ID="local:http://localhost:8080"`, or at the published
package with `NEXT_PUBLIC_DUCAT_SNAP_ID="npm:@ducat-unit/wallet-snap"`.

## Security

Keys, child keys, WIFs, and raw entropy never leave the snap. The manifest
grants entropy access only at the six complete `ducat-snap/v1` role paths.
Only derived Ducat accounts are signed for (with a Snap Home imported-key
override taking precedence when present), only the explicit `signInputs`
indexes are signed, and every signing path requires a MetaMask confirmation in
the production artifact. Frontend-supplied context is treated as untrusted
display metadata — the parsed PSBT plus fresh Snap-owned wallet/prevout
evidence is the source of truth for what's actually signed. Websites construct
and broadcast transactions. Taproot vault inputs must carry a Ducat cosign
tapleaf whose control block recomputes to the prevout output key.

The third-party security audit (Sayfer) is in
[`docs/audit.pdf`](docs/audit.pdf).

## License

See [LICENSE](LICENSE).
