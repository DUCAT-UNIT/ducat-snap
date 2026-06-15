#!/usr/bin/env node
// Regenerate recorded release evidence (manifest shasum, npm pack shasum/integrity/size, and the
// snapper finding count) to match the current dist/bundle.js. Run after rebuilding the bundle.
//
// Ordering matters: README.md and SNAPPER_REVIEW.md are inside the npm tarball, so any edit to them
// changes the pack shasum. We therefore (1) update the manifest shasum + snapper count first
// (touching packaged files), then (2) compute the final pack shasum and write it only into the
// NON-packaged evidence files, making the result a stable fixed point.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => writeFileSync(path.join(root, file), content);

function replaceAcross(files, pairs) {
  for (const file of files) {
    let content = read(file);
    let changed = 0;
    for (const [oldVal, newVal] of pairs) {
      if (oldVal !== newVal && content.includes(oldVal)) {
        content = content.split(oldVal).join(newVal);
        changed += 1;
      }
    }
    if (changed) {
      write(file, content);
      console.log(`  ${file}: ${changed} replacement(s)`);
    }
  }
}

function packDryRun() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0];
}

const directory = JSON.parse(read('submission/metamask-directory.json'));
const manifestShasum = JSON.parse(read('snap.manifest.json')).source.shasum;

// 1) Manifest shasum + snapper count into all evidence (including packaged README/SNAPPER_REVIEW).
const oldManifestShasum = directory.verification.manifestSourceShasum;
const allEvidence = [
  'RELEASE_EVIDENCE.md', 'README.md', 'AUDITOR_HANDOFF.md', 'SNAPPER_REVIEW.md',
  'submission/ALLOWLIST_SUBMISSION.md', 'submission/metamask-directory.json', 'submission/e2e/README.md',
];

console.log('Manifest shasum:', oldManifestShasum, '->', manifestShasum);
replaceAcross(allEvidence, [[oldManifestShasum, manifestShasum]]);

// Snapper count (regenerate the report first so the count is authoritative).
execFileSync('npm', ['run', 'snapper'], { cwd: root, stdio: 'ignore' });
const snapper = JSON.parse(read('snapper-report.json'));
const snapperCount = Object.values(snapper).filter(Array.isArray).flat().length;
const reviewBefore = read('SNAPPER_REVIEW.md');
const reviewAfter = reviewBefore.replace(/Local result: \d+ findings/u, `Local result: ${snapperCount} findings`);
if (reviewBefore !== reviewAfter) {
  write('SNAPPER_REVIEW.md', reviewAfter);
  console.log(`Snapper count -> ${snapperCount}`);
}

// 2) Now that all packaged files are final, compute the stable pack values and write them into the
//    NON-packaged evidence files only.
const pack = packDryRun();
const nonPackagedEvidence = ['RELEASE_EVIDENCE.md', 'AUDITOR_HANDOFF.md', 'submission/ALLOWLIST_SUBMISSION.md', 'submission/metamask-directory.json'];

console.log('Pack shasum:', directory.verification.packageShasum, '->', pack.shasum);
replaceAcross(nonPackagedEvidence, [
  [directory.verification.packageShasum, pack.shasum],
  [directory.verification.packageIntegrity, pack.integrity],
]);

// Pack size / unpacked size live only in RELEASE_EVIDENCE.md.
const evidence = read('RELEASE_EVIDENCE.md')
  .replace(/Dry-run package size: `\d+`/u, `Dry-run package size: \`${pack.size}\``)
  .replace(/Dry-run unpacked size: `\d+`/u, `Dry-run unpacked size: \`${pack.unpackedSize}\``)
  .replace(/Dry-run file count: `\d+`/u, `Dry-run file count: \`${pack.entryCount}\``);
write('RELEASE_EVIDENCE.md', evidence);

console.log('Release evidence regenerated. Pack size:', pack.size, 'unpacked:', pack.unpackedSize, 'files:', pack.entryCount);
