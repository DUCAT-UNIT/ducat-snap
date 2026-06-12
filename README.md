# Ducat MetaMask Snap

`@ducat-unit/ducat-snap` is a standalone MetaMask Snap for Ducat Bitcoin accounts and signing.

The Snap derives deterministic Bitcoin testnet accounts from the user's MetaMask Secret Recovery Phrase and exposes a small Ducat JSON-RPC API to the Ducat frontend. The Ducat web app remains the action surface; the Snap handles account derivation, signing confirmations, PSBT/message signing, a simple send transfer path, recent action state, and a Snap home page with account addresses, BTC/UNIT balance lookups, vault summary, and Ducat app deep links.

## Launch Scope

- Visible Snap name: `Ducat`
- Package name: `@ducat-unit/ducat-snap`
- V1 networks: `signet` and `mutinynet`
- V1 derivation paths:
  - sats: `m/84'/1'/0'/0/0`, P2WPKH `tb1q...`, compressed 33-byte public key
  - runes/vault: `m/86'/1'/0'/0/0`, P2TR `tb1p...`, x-only 32-byte internal public key
- Mainnet is intentionally not enabled in this manifest.

## JSON-RPC API

- `ducat_getAccounts({ network })`
- `ducat_signMessage({ network, address, message })`
- `ducat_signPsbt({ network, psbt, signInputs, context })`
- `ducat_signBatch({ network, entries, context })`
- `ducat_sendTransfer({ network, address, amountSats, feeRate })`
- `ducat_getHomeState({ network })`

## Development

```bash
npm install
npm run type-check
npm test
npm run build
npm run manifest
npm run serve
```

Use a local Snap ID such as `local:http://localhost:8080` in the frontend during development.

## Release Verification

```bash
npm ci
npm run verify:release
npm pack
```

`npm run verify:release` runs type-checking, Jest, `mm-snap build`, `mm-snap manifest`, production dependency audit, Snapper, and package dry-run. The public repository should also run `.github/workflows/verify.yml` on every pull request and `main` push.

MetaMask submission inputs live in `submission/metamask-directory.json`; screenshots belong in `submission/screenshots/`.

## Security Model

- Private keys never leave the Snap.
- Only explicit `signInputs` indexes are signed.
- The Snap signs only inputs that match derived Ducat Snap addresses.
- Every signing and transfer method requires a MetaMask confirmation.
- Friendly action metadata from the frontend is displayed as context only; parsed PSBT data is the trusted signing summary.
