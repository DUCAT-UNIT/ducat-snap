#!/usr/bin/env node
/**
 * apply-dev-origins.mjs — inject dev-only dapp origins into the snap manifest.
 *
 * The published `snap.manifest.json` is HTTPS-Ducat-only. A DEV build also needs
 * those origins in `initialPermissions['endowment:rpc'].allowedOrigins` (MetaMask
 * enforces the manifest allowlist independently of the in-code check), so a local
 * dapp such as the regtest-stack frontend (http://localhost:3000) is authorized.
 *
 * This patches an explicit generated manifest (normally
 * `.snap/dev/snap.manifest.json`) — never the tracked production manifest. It
 * is meant to run inside the host-clean dev container, AFTER `mm-snap build`
 * and BEFORE `mm-snap manifest --fix`:
 *
 *   node scripts/prepare-dev-build.mjs
 *   DUCAT_SNAP_DEV_ORIGINS=http://localhost:3000 mm-snap build -c snap.config.dev.ts
 *   DUCAT_SNAP_DEV_ORIGINS=http://localhost:3000 \
 *     node scripts/apply-dev-origins.mjs .snap/dev/snap.manifest.json
 *   mm-snap manifest -c snap.config.dev.ts --fix
 *
 * The `--fix` pass is mandatory, not cosmetic: `mm-snap build`'s own shasum write
 * does NOT match what the snap loader (`@metamask/snaps-controllers`) recomputes
 * from the dev bundle, so without `manifest --fix` the dev snap fails to install
 * with "manifest shasum does not match computed shasum". (Verified 2026-06-17.)
 *
 * With DUCAT_SNAP_DEV_ORIGINS unset/empty it is a no-op, so it is safe to call
 * unconditionally from a build target.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.argv[2];

if (!manifestPath) {
  throw new Error('usage: apply-dev-origins.mjs <generated-manifest-path>');
}

const manifest = resolve(root, manifestPath);

if (!manifest.startsWith(`${resolve(root, '.snap')}/`)) {
  throw new Error('development origins may only be written under the ignored .snap directory');
}

const devOrigins = (process.env.DUCAT_SNAP_DEV_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (devOrigins.length === 0) {
  console.log('apply-dev-origins: DUCAT_SNAP_DEV_ORIGINS empty — no change (published build).');
  process.exit(0);
}

const manifestData = JSON.parse(readFileSync(manifest, 'utf8'));
const rpc = manifestData.initialPermissions?.['endowment:rpc'];

if (!rpc || !Array.isArray(rpc.allowedOrigins)) {
  throw new Error('snap.manifest.json has no initialPermissions["endowment:rpc"].allowedOrigins to extend.');
}

const before = rpc.allowedOrigins.length;
rpc.allowedOrigins = [...new Set([...rpc.allowedOrigins, ...devOrigins])];

writeFileSync(manifest, `${JSON.stringify(manifestData, null, 2)}\n`, 'utf8');

console.log(
  `apply-dev-origins: added ${rpc.allowedOrigins.length - before} dev origin(s) [${devOrigins.join(', ')}]; ` +
    'run `mm-snap manifest -c snap.config.dev.ts --fix` next to write the loader-authoritative shasum.',
);
