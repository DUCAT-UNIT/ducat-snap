#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
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

const packageJson = readJson('package.json');
const manifest = readJson('snap.manifest.json');
const directory = readJson('submission/metamask-directory.json');
const releaseEvidence = readText('RELEASE_EVIDENCE.md');
const allowlistSubmission = readText('submission/ALLOWLIST_SUBMISSION.md');
const auditorHandoff = readText('AUDITOR_HANDOFF.md');
const submissionReadme = readText('submission/README.md');
const pack = npmPackDryRun();

const candidateTag = directory.audit.candidateTag;
const candidateCommit = directory.audit.candidateCommit;
const manifestShasum = manifest.source.shasum;

assertEqual(manifest.version, packageJson.version, 'manifest version');
assertEqual(directory.snap.version, packageJson.version, 'submission version');
assertEqual(directory.snap.packageName, packageJson.name, 'submission package name');
assertEqual(directory.snap.proposedName, manifest.proposedName, 'submission proposed name');
assertEqual(directory.verification.manifestSourceShasum, manifestShasum, 'submission manifest shasum');
assertEqual(directory.verification.packageShasum, pack.shasum, 'submission package shasum');
assertEqual(directory.verification.packageIntegrity, pack.integrity, 'submission package integrity');

for (const [label, contents] of [
  ['RELEASE_EVIDENCE.md', releaseEvidence],
  ['submission/ALLOWLIST_SUBMISSION.md', allowlistSubmission],
  ['AUDITOR_HANDOFF.md', auditorHandoff],
  ['submission/README.md', submissionReadme],
]) {
  assertContains(contents, candidateTag, label);
  assertContains(contents, candidateCommit, label);
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

const tagTarget = gitTagTarget(candidateTag);
if (tagTarget) {
  assertEqual(tagTarget, candidateCommit, 'audit candidate tag target');
}

console.log('Release metadata is consistent.');
