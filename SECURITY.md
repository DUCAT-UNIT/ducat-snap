# Security

Report security issues privately to the Ducat maintainers before public disclosure.

Release requirements:

- Third-party audit for key-management usage of `snap_getBip32Entropy`.
- MetaMask allowlist/directory review before production distribution.
- Production dependency audit and Snapper/security scan for every release candidate.
- No mainnet permissions until a separate mainnet audit delta is complete.

`@ducat-unit/wallet-snap@0.1.4` supports signet and mutinynet only. It signs only explicit PSBT input indexes that match Snap-derived addresses and requires MetaMask confirmation before message, PSBT, batch, or transfer signing.
