#!/usr/bin/env node

const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isLocalOrigin(origin) {
  const url = new URL(origin);

  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

function assertHttpsDucatOrigin(origin) {
  assert(typeof origin === 'string' && origin.length > 0, 'Release frontend origin must be a non-empty string.');
  assert(!origin.includes('*'), `Release frontend origin must not use a wildcard: ${origin}`);

  const url = new URL(origin);

  assert(url.protocol === 'https:', `Release frontend origin must use HTTPS: ${origin}`);
  assert(!isLocalOrigin(origin), `Release frontend origin must not be localhost: ${origin}`);
  assert(url.hostname === 'app.ducatprotocol.com' || url.hostname.endsWith('.app.ducatprotocol.com'), `Release frontend origin must be a Ducat app origin: ${origin}`);
}

const manifest = readJson('snap.manifest.json');
const directory = readJson('submission/metamask-directory.json');
const devOrigins = manifest.initialPermissions?.['endowment:rpc']?.allowedOrigins;
const releaseOrigins = directory.launchScope?.releaseFrontendOrigins;

assert(Array.isArray(devOrigins), 'snap.manifest.json endowment:rpc.allowedOrigins must be an array.');
assert(Array.isArray(releaseOrigins) && releaseOrigins.length > 0, 'submission/metamask-directory.json must define launchScope.releaseFrontendOrigins.');
assert(new Set(releaseOrigins).size === releaseOrigins.length, 'Release frontend origins must be unique.');

for (const origin of releaseOrigins) {
  assertHttpsDucatOrigin(origin);
  assert(devOrigins.includes(origin), `Release frontend origin is not present in the development manifest: ${origin}`);
}

const releaseManifest = JSON.parse(JSON.stringify(manifest));

releaseManifest.initialPermissions['endowment:rpc'].allowedOrigins = releaseOrigins;

const releaseManifestOrigins = releaseManifest.initialPermissions['endowment:rpc'].allowedOrigins;

assert(releaseManifestOrigins.every((origin) => !isLocalOrigin(origin)), 'Generated release manifest still contains a localhost origin.');
assert(releaseManifestOrigins.every((origin) => new URL(origin).protocol === 'https:'), 'Generated release manifest contains a non-HTTPS origin.');

console.log(`Release manifest origin check passed for ${releaseManifestOrigins.length} HTTPS origin(s).`);
