#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredScreenshots = [
  '01-install-approval.png',
  '02-wallet-selector.png',
  '03-connected-accounts.png',
  '04-psbt-confirmation.png',
  '05-batch-confirmation.png',
  '06-message-confirmation.png',
  '07-transfer-confirmation.png',
  '08-snap-home.png',
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoPendingTokens(label, value) {
  const tokens = String(value).match(/PENDING_[A-Z0-9_]+/gu) ?? [];

  assert(tokens.length === 0, `${label} still contains pending placeholder(s): ${[...new Set(tokens)].join(', ')}`);
}

function assertHttpsUrl(label, value) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty URL.`);

  const url = new URL(value);

  assert(url.protocol === 'https:', `${label} must use HTTPS: ${value}`);
}

function assertPng(relativePath) {
  const filePath = path.join(root, relativePath);

  assert(existsSync(filePath), `Missing required screenshot: ${relativePath}`);

  const signature = readFileSync(filePath).subarray(0, 8);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  assert(signature.equals(pngSignature), `Required screenshot is not a PNG file: ${relativePath}`);
}

function npmPackageMetadata(packageName, version) {
  const output = execFileSync('npm', ['view', `${packageName}@${version}`, 'version', 'dist.shasum', 'dist.integrity', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(output);
}

const directory = readJson('submission/metamask-directory.json');
const allowlistSubmission = readText('submission/ALLOWLIST_SUBMISSION.md');
const externalGates = readText('submission/EXTERNAL_GATES.md');
const packageJson = readJson('package.json');

assertNoPendingTokens('submission/metamask-directory.json', JSON.stringify(directory));
assertNoPendingTokens('submission/ALLOWLIST_SUBMISSION.md', allowlistSubmission);
assertNoPendingTokens('submission/EXTERNAL_GATES.md', externalGates);

assertHttpsUrl('audit report URL', directory.audit.auditReportUrl);
assertHttpsUrl('demo video URL', directory.submissionAssets.demoVideoUrl);

for (const fileName of requiredScreenshots) {
  assertPng(path.join('submission/screenshots', fileName));
}

const npmMetadata = npmPackageMetadata(packageJson.name, packageJson.version);

assert(npmMetadata.version === packageJson.version, `Published npm version mismatch. Expected ${packageJson.version}, got ${npmMetadata.version}.`);
assert(npmMetadata['dist.shasum'] === directory.verification.packageShasum, 'Published npm shasum does not match submission metadata.');
assert(npmMetadata['dist.integrity'] === directory.verification.packageIntegrity, 'Published npm integrity does not match submission metadata.');

console.log('Submission packet is ready for MetaMask directory review.');
