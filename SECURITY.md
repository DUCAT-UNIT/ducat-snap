# Security

Report security issues privately to the Ducat maintainers before public disclosure.

Release requirements:

- Third-party audit for key-management usage of `snap_getBip32Entropy`.
- MetaMask allowlist/directory review before production distribution.
- Production dependency audit and Snapper/security scan for every release candidate.
- Mainnet key derivation, signing, and broadcast support must be covered by the third-party audit before production distribution.

`@ducat-unit/wallet-snap@0.1.5` supports mainnet, signet, and mutinynet. It signs only explicit PSBT input indexes that match Snap-derived addresses and requires MetaMask confirmation before message, PSBT, batch, or transfer signing.
