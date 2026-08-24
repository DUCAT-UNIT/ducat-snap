#!/usr/bin/env node
/** Create the ignored, alpha-only Snap runtime from the tracked production manifest. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALPHA_ORIGIN = 'http://localhost:8075';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const alphaRoot = join(root, '.snap', 'alpha');

if (process.env.DUCAT_SNAP_ARTIFACT_POLICY !== 'alpha-mainnet') {
  throw new Error('prepare-alpha-build requires DUCAT_SNAP_ARTIFACT_POLICY=alpha-mainnet');
}

for (const name of ['ALPHA_MAINNET_VALIDATOR_BASE_URL', 'ALPHA_MAINNET_ESPLORA_BASE_URL']) {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} is required for the alpha-mainnet Snap build`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a credential-free HTTPS URL without query or fragment`);
  }
}

const manifest = JSON.parse(readFileSync(join(root, 'snap.manifest.json'), 'utf8'));
const rpc = manifest.initialPermissions?.['endowment:rpc'];
if (!rpc || !Array.isArray(rpc.allowedOrigins)) {
  throw new Error('tracked snap.manifest.json has no RPC origin policy');
}
rpc.allowedOrigins = [ALPHA_ORIGIN];

rmSync(alphaRoot, { recursive: true, force: true });
mkdirSync(join(alphaRoot, 'images'), { recursive: true });
writeFileSync(join(alphaRoot, 'snap.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
writeFileSync(join(alphaRoot, 'package.json'), readFileSync(join(root, 'package.json')), { mode: 0o644 });
writeFileSync(join(alphaRoot, 'images', 'icon.svg'), readFileSync(join(root, 'images', 'icon.svg')), { mode: 0o644 });

console.log(`prepare-alpha-build: created isolated Snap runtime at ${alphaRoot}`);
