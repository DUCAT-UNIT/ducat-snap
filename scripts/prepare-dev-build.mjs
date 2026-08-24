#!/usr/bin/env node
/**
 * Create the ignored runtime root used by the local Snap server.
 *
 * The tracked manifest is the production policy. Development origins and the
 * development bundle shasum belong only in `.snap/dev/snap.manifest.json`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDevelopmentOrigins } from './dev-origin-policy.mjs';

const REVIEWED_DEVELOPMENT_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://localhost:8075',
  'http://frontend:3000',
  'http://ducat-admin:8075',
]);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const devRoot = join(root, '.snap', 'dev');

if (process.env.DUCAT_SNAP_ARTIFACT_POLICY !== 'development') {
  throw new Error('prepare-dev-build requires DUCAT_SNAP_ARTIFACT_POLICY=development');
}

const manifest = JSON.parse(readFileSync(join(root, 'snap.manifest.json'), 'utf8'));
const rpc = manifest.initialPermissions?.['endowment:rpc'];
if (!rpc || !Array.isArray(rpc.allowedOrigins)) {
  throw new Error('tracked snap.manifest.json has no RPC origin policy');
}
const developmentOrigins = parseDevelopmentOrigins(process.env.DUCAT_SNAP_DEV_ORIGINS ?? '');
if (JSON.stringify(developmentOrigins) !== JSON.stringify(REVIEWED_DEVELOPMENT_ORIGINS)) {
  throw new Error('DUCAT_SNAP_DEV_ORIGINS must contain the exact reviewed development origins in order');
}
rpc.allowedOrigins = developmentOrigins;

rmSync(devRoot, { recursive: true, force: true });
mkdirSync(join(devRoot, 'images'), { recursive: true });
writeFileSync(
  join(devRoot, 'snap.manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
writeFileSync(
  join(devRoot, 'package.json'),
  readFileSync(join(root, 'package.json')),
  { mode: 0o644 },
);
writeFileSync(
  join(devRoot, 'images', 'icon.svg'),
  readFileSync(join(root, 'images', 'icon.svg')),
  { mode: 0o644 },
);

console.log(`prepare-dev-build: created isolated Snap runtime at ${devRoot}`);
