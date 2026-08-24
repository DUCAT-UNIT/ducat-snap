import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertPackagePaths,
  decodePackJson,
  EXPECTED_PACKAGE_PATHS,
} from './package-policy.mjs';

function packResult(paths) {
  return JSON.stringify([{ files: paths.map((path) => ({ path })) }]);
}

test('accepts the independently reviewed package path list', () => {
  assert.deepEqual(decodePackJson(packResult(EXPECTED_PACKAGE_PATHS)), EXPECTED_PACKAGE_PATHS);
});

for (const paths of [
  EXPECTED_PACKAGE_PATHS.filter((path) => path !== 'LICENSE'),
  [...EXPECTED_PACKAGE_PATHS, 'docs/audit.pdf'],
  [...EXPECTED_PACKAGE_PATHS, EXPECTED_PACKAGE_PATHS[0]],
  [...EXPECTED_PACKAGE_PATHS, '.snap/dev/snap.manifest.json'],
  [...EXPECTED_PACKAGE_PATHS, '.snap/alpha/snap.manifest.json'],
  [...EXPECTED_PACKAGE_PATHS, 'ducat-unit-wallet-snap-0.2.3.tgz'],
]) {
  test(`rejects non-reviewed package paths: ${paths.at(-1)}`, () => {
    assert.throws(() => assertPackagePaths(paths), /package path policy mismatch|duplicate package path/);
  });
}

test('rejects unsafe or non-normalized package paths', () => {
  for (const path of ['/etc/passwd', '../secret', './README.md', 'images/../README.md', 'images\\icon.svg']) {
    assert.throws(() => assertPackagePaths([...EXPECTED_PACKAGE_PATHS.slice(0, -1), path]), /invalid package path/);
  }
});

test('rejects malformed, duplicate-result, and trailing pack JSON', () => {
  assert.throws(() => decodePackJson('{'), /valid npm pack JSON/);
  assert.throws(() => decodePackJson('[]'), /exactly one npm pack result/);
  assert.throws(() => decodePackJson('[{"files":[]},{"files":[]}]'), /exactly one npm pack result/);
  assert.throws(() => decodePackJson(`${packResult(EXPECTED_PACKAGE_PATHS)} trailing`), /valid npm pack JSON/);
  assert.throws(() => decodePackJson('[{}]'), /files array/);
});
