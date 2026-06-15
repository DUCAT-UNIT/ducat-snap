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
// shippedOrigins is the allowlist that is actually published and enforced by MetaMask. We validate
// THIS array on disk (not an in-memory copy), so a localhost/preview origin cannot survive into the
// released manifest while the gate reports green.
const shippedOrigins = manifest.initialPermissions?.['endowment:rpc']?.allowedOrigins;
const releaseOrigins = directory.launchScope?.releaseFrontendOrigins;

assert(Array.isArray(shippedOrigins), 'snap.manifest.json endowment:rpc.allowedOrigins must be an array.');
assert(Array.isArray(releaseOrigins) && releaseOrigins.length > 0, 'submission/metamask-directory.json must define launchScope.releaseFrontendOrigins.');
assert(new Set(releaseOrigins).size === releaseOrigins.length, 'Release frontend origins must be unique.');
assert(new Set(shippedOrigins).size === shippedOrigins.length, 'Shipped manifest origins must be unique.');

for (const origin of releaseOrigins) {
  assertHttpsDucatOrigin(origin);
}

// Enforce the on-disk shipped manifest directly: every origin MetaMask will trust for signing must
// be an HTTPS Ducat origin (no localhost, no wildcard/preview), and the shipped set must equal the
// declared release set exactly — no extra dev origins smuggled in, none of the release set missing.
for (const origin of shippedOrigins) {
  assertHttpsDucatOrigin(origin);
}

const shippedSet = new Set(shippedOrigins);
const releaseSet = new Set(releaseOrigins);

assert(
  shippedSet.size === releaseSet.size && [...releaseSet].every((origin) => shippedSet.has(origin)),
  `Shipped manifest allowedOrigins must equal the release frontend origins exactly.\n  shipped:  ${[...shippedSet].sort().join(', ')}\n  release:  ${[...releaseSet].sort().join(', ')}`,
);

assert(shippedOrigins.every((origin) => !isLocalOrigin(origin)), 'Shipped manifest still contains a localhost origin.');
assert(shippedOrigins.every((origin) => new URL(origin).protocol === 'https:'), 'Shipped manifest contains a non-HTTPS origin.');

console.log(`Release manifest origin check passed: shipped manifest contains exactly ${shippedOrigins.length} HTTPS Ducat origin(s).`);
