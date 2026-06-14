# Ducat Snap Audit Scope

This file defines the minimum security review scope before publishing `@ducat-unit/wallet-snap` or submitting it for MetaMask allowlisting.

## In Scope

- `snap.manifest.json` permissions and allowed origins.
- BIP32 entropy use for `m/84'/1'` and `m/86'/1'`.
- Local BIP32 child derivation in `src/bip32.ts`.
- Account derivation in `src/accounts.ts`.
- BIP322-style message signing in `src/message.ts`.
- PSBT parsing, validation, summarization, and signing in `src/psbt.ts`.
- Taproot script-path commitment verification in `src/psbt.ts`.
- Ducat vault sequence and OP_RETURN return-data decoding in `src/psbt.ts`.
- Transfer construction, signing, and broadcast in `src/transfer.ts`.
- RPC routing and origin authorization in `src/rpc.ts`.
- User confirmation content in `src/confirmations.ts`.
- State storage in `src/state.ts`.
- Home page network fetches in `src/home.ts`.
- Build artifacts produced by `npm run verify`.

## Required Findings To Rule Out

- Any path that exports, logs, stores, or returns private keys or raw entropy.
- Any signing path that signs an input not explicitly listed in `signInputs`.
- Any signing path that signs inputs for addresses not derived by the Snap.
- Any irreversible operation that can proceed without a MetaMask confirmation.
- Any mainnet key path, address, broadcast endpoint, or signing support in V1.
- Any unauthorized origin able to invoke Snap RPC methods.
- Any malformed PSBT, wrong-network PSBT, unknown address, or unknown input index that is accepted.
- Any package dependency that violates MetaMask Snap SES constraints or creates avoidable key-management risk.
- Any Taproot script-path behavior that signs a Ducat vault input without proving the tapleaf commits to the prevout output key and contains the derived vault pubkey.

## Audit Evidence

The final audit package should include:

- Public source repository URL.
- Audited commit hash.
- Fixed commit hash, if fixes are required.
- `npm pack --dry-run` output.
- `npm audit --omit=dev` output.
- `npm run verify` output.
- Snapper/security scan output.
- Final `snap.manifest.json` shasum.
- Demo video URL following `DEMO_SCRIPT.md`.
