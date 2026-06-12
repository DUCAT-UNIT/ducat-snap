# Dependency Audit Notes

Last local production audit:

```bash
npm run audit:prod
```

Result: 0 production vulnerabilities.

Last local full audit:

```bash
npm audit
```

Result: 31 development-toolchain vulnerabilities, all low or moderate.

## Current Assessment

The published Snap package contains the production bundle and release metadata. `npm audit --omit=dev` is clean for production dependencies.

Direct `dependencies` and `devDependencies` in `package.json` are pinned to exact versions. Transitive dependency versions are locked by `package-lock.json`.

The full audit findings are in development tooling paths, primarily transitive dependencies of MetaMask Snap build/test tooling. `npm audit fix --package-lock-only` did not resolve them. npm reports that the remaining forced path would install older breaking versions of MetaMask Snap packages, so it was not applied locally.

## Release Requirement

Before public submission, re-run:

```bash
npm audit
npm run audit:prod
```

Then review whether newer compatible MetaMask Snap SDK/CLI releases are available, or document auditor approval for the remaining dev-toolchain findings if production dependencies remain clean.
