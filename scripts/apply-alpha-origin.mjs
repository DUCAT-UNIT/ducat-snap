#!/usr/bin/env node
/** Replace the generated alpha manifest authority with the one reviewed Admin origin. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALPHA_ORIGIN = 'http://localhost:8075';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = process.argv[2];

if (process.env.DUCAT_SNAP_ARTIFACT_POLICY !== 'alpha-mainnet') {
  throw new Error('apply-alpha-origin requires DUCAT_SNAP_ARTIFACT_POLICY=alpha-mainnet');
}
if (!manifestPath) {
  throw new Error('usage: apply-alpha-origin.mjs <generated-manifest-path>');
}

const manifest = resolve(root, manifestPath);
const alphaRoot = `${resolve(root, '.snap', 'alpha')}/`;
if (!manifest.startsWith(alphaRoot)) {
  throw new Error('alpha origin may only be written under the ignored .snap/alpha directory');
}

const manifestData = JSON.parse(readFileSync(manifest, 'utf8'));
const rpc = manifestData.initialPermissions?.['endowment:rpc'];
if (!rpc || !Array.isArray(rpc.allowedOrigins)) {
  throw new Error('snap.manifest.json has no RPC origin policy');
}
rpc.allowedOrigins = [ALPHA_ORIGIN];
writeFileSync(manifest, `${JSON.stringify(manifestData, null, 2)}\n`, 'utf8');

console.log(`apply-alpha-origin: set exact alpha origin ${ALPHA_ORIGIN}`);
