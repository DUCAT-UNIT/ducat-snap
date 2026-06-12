# Security

Report security issues privately to the Ducat maintainers before public disclosure.

Production release requirements:

- Third-party audit for key-management usage of `snap_getBip32Entropy`.
- MetaMask allowlist/directory review.
- Dependency audit and Snapper/security scan.
- No mainnet permissions until the mainnet release audit delta is complete.

V1 signs only explicit PSBT input indexes that match the Snap-derived signet/mutinynet addresses.

