# CLAUDE.md

The Ducat Bitcoin account and signing Snap for MetaMask. It custodies the
user's Bitcoin keys inside MetaMask and signs vault PSBTs, so MetaMask can act
as the single wallet for DUCAT.

This repository is a git submodule of the **ducat-infra** superproject (the
local DUCAT regtest stack). DUCAT is a Bitcoin-native protocol for
collateralized borrowing using vaults, guardians, and oracles.

## Working here

- Build, run, and test commands live in [README.md](README.md).
- This Snap is normally built and exercised through the `ducat-infra` stack
  (`make snap-*` / `make demo-up`). See that superproject's `AGENTS.md`,
  `docs/`, and `dev/docs/ducat-snap-demo.md` for protocol context and the full
  service topology.

## Conventions

Follow the DUCAT TypeScript house style: `snake_case` functions/variables,
`PascalCase` types, ESM with `.js` import extensions, named exports. Match the
patterns already in this repo, keep changes scoped to this submodule, and commit
them here before bumping the pointer in `ducat-infra`.
