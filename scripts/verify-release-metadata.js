#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

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

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} mismatch. Expected ${expected}, got ${actual}.`);
}

function assertContains(contents, expected, label) {
  assert(contents.includes(expected), `${label} does not contain ${expected}.`);
}

function assertJsonEqual(actual, expected, label) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label);
}

function npmPackDryRun() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entries = JSON.parse(output);
  const pack = entries[0];

  assert(pack, 'npm pack --dry-run --json returned no package metadata.');

  return pack;
}

function gitTagTarget(tag) {
  try {
    return execFileSync('git', ['rev-list', '-n', '1', tag], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function gitHeadCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function expectedCandidateCommit() {
  if (process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH)) {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      const pullRequestHeadSha = event.pull_request?.head?.sha;

      if (typeof pullRequestHeadSha === 'string' && pullRequestHeadSha) {
        return pullRequestHeadSha;
      }
    } catch {
      return gitHeadCommit();
    }
  }

  return gitHeadCommit();
}

const packageJson = readJson('package.json');
const manifest = readJson('snap.manifest.json');
const directory = readJson('submission/metamask-directory.json');
const releaseEvidence = readText('RELEASE_EVIDENCE.md');
const allowlistSubmission = readText('submission/ALLOWLIST_SUBMISSION.md');
const auditorHandoff = readText('AUDITOR_HANDOFF.md');
const externalGates = readText('submission/EXTERNAL_GATES.md');
const submissionReadme = readText('submission/README.md');
const snapperReview = readText('SNAPPER_REVIEW.md');
const pack = npmPackDryRun();

const candidateTag = directory.audit.candidateTag;
const manifestShasum = manifest.source.shasum;
const packagedFiles = new Set(pack.files.map((file) => file.path));
const manifestPermissions = manifest.initialPermissions ?? {};

const requiredPackageFiles = [
  'AUDIT_SCOPE.md',
  'DEMO_SCRIPT.md',
  'DEPENDENCY_AUDIT.md',
  'LICENSE',
  'LISTING.md',
  'PRIVACY.md',
  'README.md',
  'RELEASE_CHECKLIST.md',
  'SECURITY.md',
  'SNAPPER_REVIEW.md',
  'SUPPORT.md',
  'dist/bundle.js',
  'images/icon.svg',
  'package.json',
  'snap.manifest.json',
];

assertEqual(manifest.version, packageJson.version, 'manifest version');
assertEqual(directory.snap.version, packageJson.version, 'submission version');
assertEqual(directory.snap.packageName, packageJson.name, 'submission package name');
assertEqual(directory.snap.proposedName, manifest.proposedName, 'submission proposed name');
assertEqual(directory.verification.manifestSourceShasum, manifestShasum, 'submission manifest shasum');
assertEqual(directory.verification.packageShasum, pack.shasum, 'submission package shasum');
assertEqual(directory.verification.packageIntegrity, pack.integrity, 'submission package integrity');
assertEqual(directory.launchScope.mainnetEnabled, false, 'submission mainnet flag');
assertJsonEqual([...directory.launchScope.networks].sort(), ['mutinynet', 'signet'], 'submission networks');
assertJsonEqual([...directory.launchScope.derivationPaths].sort(), ["m/84'/1'", "m/86'/1'"], 'submission derivation paths');

const rpcOrigins = manifestPermissions['endowment:rpc']?.allowedOrigins;
assert(Array.isArray(rpcOrigins), 'manifest endowment:rpc.allowedOrigins must be an array.');
assertJsonEqual([...rpcOrigins].sort(), [...directory.launchScope.frontendOrigins].sort(), 'manifest RPC origins');

for (const origin of rpcOrigins) {
  assert(!origin.includes('*'), `manifest RPC origin must not use a wildcard: ${origin}`);

  const url = new URL(origin);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  assert(url.protocol === 'https:' || (isLocal && url.protocol === 'http:'), `manifest RPC origin must be HTTPS unless local: ${origin}`);
}

const bip32Permissions = manifestPermissions.snap_getBip32Entropy;
assert(Array.isArray(bip32Permissions), 'manifest snap_getBip32Entropy must be an array.');
const bip32Paths = bip32Permissions.map((permission) => permission.path.join('/'));

assertJsonEqual([...bip32Paths].sort(), [...directory.launchScope.derivationPaths].sort(), 'manifest BIP32 derivation paths');
for (const permission of bip32Permissions) {
  assertEqual(permission.curve, 'secp256k1', `BIP32 curve for ${permission.path.join('/')}`);
  assert(permission.path[2] === "1'", `BIP32 path ${permission.path.join('/')} must stay on Bitcoin testnet coin type 1'.`);
}

for (const requiredFile of requiredPackageFiles) {
  assert(packagedFiles.has(requiredFile), `npm package is missing required release artifact ${requiredFile}.`);
}

for (const [label, contents] of [
  ['RELEASE_EVIDENCE.md', releaseEvidence],
  ['submission/ALLOWLIST_SUBMISSION.md', allowlistSubmission],
  ['AUDITOR_HANDOFF.md', auditorHandoff],
  ['submission/README.md', submissionReadme],
]) {
  assertContains(contents, candidateTag, label);
}

for (const [label, contents] of [
  ['RELEASE_EVIDENCE.md', releaseEvidence],
  ['submission/ALLOWLIST_SUBMISSION.md', allowlistSubmission],
  ['AUDITOR_HANDOFF.md', auditorHandoff],
]) {
  assertContains(contents, pack.shasum, label);
  assertContains(contents, pack.integrity, label);
  assertContains(contents, manifestShasum, label);
}

assertContains(releaseEvidence, `Dry-run package size: \`${pack.size}\``, 'RELEASE_EVIDENCE.md');
assertContains(releaseEvidence, `Dry-run unpacked size: \`${pack.unpackedSize}\``, 'RELEASE_EVIDENCE.md');
assertContains(releaseEvidence, `Dry-run file count: \`${pack.entryCount}\``, 'RELEASE_EVIDENCE.md');

if (existsSync(path.join(root, 'snapper-report.json'))) {
  const snapperReport = readJson('snapper-report.json');
  const snapperCategories = Object.entries(snapperReport).filter(([, findings]) => Array.isArray(findings) && findings.length > 0);
  const snapperFindings = snapperCategories.flatMap(([, findings]) => findings);
  const riskRatings = new Set(snapperFindings.map((finding) => finding.riskRating));
  const categoryNames = snapperCategories.map(([category]) => category);

  assertContains(snapperReview, `Local result: ${snapperFindings.length} findings`, 'SNAPPER_REVIEW.md');
  if (riskRatings.size === 1) {
    assertContains(snapperReview, `all risk ${Array.from(riskRatings)[0]}`, 'SNAPPER_REVIEW.md');
  }
  if (categoryNames.length === 1) {
    assertContains(snapperReview, `\`${categoryNames[0]}\` category`, 'SNAPPER_REVIEW.md');
  }
}

const pendingTokenPattern = /PENDING_[A-Z0-9_]+/gu;
const remainingPendingTokens = new Set([
  ...Array.from(allowlistSubmission.matchAll(pendingTokenPattern), ([match]) => match),
  ...Array.from(JSON.stringify(directory).matchAll(pendingTokenPattern), ([match]) => match),
]);
const documentedPendingTokens = new Set(Array.from(externalGates.matchAll(pendingTokenPattern), ([match]) => match));

for (const token of remainingPendingTokens) {
  assert(documentedPendingTokens.has(token), `Remaining placeholder ${token} is not documented in submission/EXTERNAL_GATES.md.`);
}

for (const token of documentedPendingTokens) {
  assert(remainingPendingTokens.has(token), `submission/EXTERNAL_GATES.md documents ${token}, but that placeholder is no longer present.`);
}

const tagTarget = gitTagTarget(candidateTag);
if (tagTarget) {
  const expectedCommit = expectedCandidateCommit();

  if (expectedCommit) {
    assertEqual(tagTarget, expectedCommit, 'audit candidate tag target');
  }

  console.log(`Audit candidate tag ${candidateTag} resolves to ${tagTarget}.`);
}

console.log('Release metadata is consistent.');
