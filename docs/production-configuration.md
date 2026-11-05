# Bundled production configuration

The Snap loads guardian public keys from `src/networks.ts` and Bitcoin endpoint defaults from `src/network-profiles.json`. No private guardian keys, DKG shares, or credentials belong in the bundle. Existing explicit endpoint overrides remain intact.

## Mainnet guardian

Aggregate x-only FROST key: `ae14e844894a298e6d731428582618bba86f86e5cd6f14ee94082db4f2ed4c45`.

Provenance: mainnet DKG run `m202611035fb7`, completion receipt dated 2026-11-03 (3-of-4), and confirmed UNITUSD anchor transaction `c4c3915aa1fb7f0d8843db634ad777e77db1570138e2abe6847d4834bd87f508`, signer group 21. The four participants jointly control this single aggregate key; their individual shares are not wallet cosigners. The oracle key (group 22) is not a guardian and is not added to this signing allowlist.

Unknown guardian keys, missing/malformed mainnet configuration, and keys also configured for test deployments are rejected. This does not certify validator availability or operational guardian readiness.

## Endpoint status

- Mutinynet validator: `https://validator-mutinynet.prod.ducatprotocol.com`. Live `/api/proto/latest` verification reported `mutiny` and guardian `ef8e6d844354a560c3fe4f68de226a136248fae4da8afc970786e78b1362ca2e`.
- Mutinynet Esplora: `https://mutinynet.com/api`.
- Mainnet Esplora: `https://mempool.space/api`.
- Mainnet validator: `https://validator-mainnet.prod.ducatprotocol.com`, supplied by the deployment owner. The hostname did not resolve during local verification; live `main` identity and UNITUSD anchor verification remain pending. Network-identity checks remain enforced.
- Application: `https://app.ducatprotocol.com`.

Mainnet wUNIT remains unconfigured until its deployed Ethereum contract is verified. No token address is inferred from the Bitcoin anchor.

The existing 0.3.1 wallet derivation paths, including the vault path, are unchanged. Released as npm package `@ducat-unit/wallet-snap@0.3.2`. Installed Snaps require an update. The published RPC allowlist is exactly `https://dev.ducatprotocol.com`, `https://test.ducatprotocol.com`, and `https://app.ducatprotocol.com`.
