# Ducat Snap

A MetaMask snap for Bitcoin accounts and signing in the
[Ducat](https://ducatprotocol.com) protocol.

It derives Bitcoin accounts from the user's MetaMask Secret Recovery Phrase,
keeps the keys inside MetaMask, and exposes a small JSON-RPC API to the Ducat
web app for message signing, PSBT signing, and simple transfers. The web app
drives everything the user does — borrow, repay, withdraw, and so on — and the
snap handles account discovery and the MetaMask confirmation prompts.

> Mainnet, signet, and mutinynet are supported. Local development against
> regtest needs a dev build (see below).

## What are snaps?

Snaps let developers extend MetaMask with capabilities it doesn't ship by
default — like support for non-EVM chains. They run in an isolated environment
with a limited set of permissions. See the
[MetaMask Snaps docs](https://docs.metamask.io/snaps/) for more.

## RPC methods

```text
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

```text
https://app.ducatprotocol.com
https://dev.app.ducatprotocol.com
https://staging.app.ducatprotocol.com
```

`localhost` and preview deployments are intentionally not in the published
manifest — a local process or a hijacked preview subdomain should never be able
to drive mainnet signing. For local QA, build with the dev origins/regtest flags
(`DUCAT_SNAP_DEV_ORIGINS`, `DUCAT_SNAP_DEV_REGTEST`); those are stripped from
the published build.

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
# MetaMask simulation harness (accounts, signing, BitVM3)
npm run verify:harness
```

Point the frontend at the local build with
`NEXT_PUBLIC_DUCAT_SNAP_ID="local:http://localhost:8080"`, or at the published
package with `NEXT_PUBLIC_DUCAT_SNAP_ID="npm:@ducat-unit/wallet-snap"`.

## Security

Keys, child keys, WIFs, and raw entropy never leave the snap. Only derived Ducat
accounts are signed for, only the explicit `signInputs` indexes are signed, and
every signing path requires a MetaMask confirmation. Frontend-supplied context
is treated as untrusted display metadata — the parsed PSBT is the source of
truth for what's actually signed. Taproot vault inputs must carry a Ducat cosign
tapleaf whose control block recomputes to the prevout output key.

The third-party security audit (Sayfer) is in
[`docs/audit.pdf`](docs/audit.pdf).

## License

See [LICENSE](LICENSE).
