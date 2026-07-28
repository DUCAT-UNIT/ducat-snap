import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { assertReleaseEnvironment } from './release-policy.mjs';

const verifyWorkflow = readFileSync(
  new URL('../.github/workflows/verify.yml', import.meta.url),
  'utf8',
);

test('accepts a clean release environment', () => {
  assert.doesNotThrow(() => assertReleaseEnvironment({}));
  assert.doesNotThrow(() => assertReleaseEnvironment({
    DUCAT_SNAP_DEV_UNPROMPTED: 'false',
    DUCAT_SNAP_DEBUG: '',
    DUCAT_SNAP_DEV_ORIGINS: '  ',
  }));
});

for (const name of ['DUCAT_SNAP_DEV_UNPROMPTED', 'DUCAT_SNAP_DEBUG']) {
  test(`rejects ${name} when enabled`, () => {
    assert.throws(
      () => assertReleaseEnvironment({ [name]: 'true' }),
      new RegExp(`${name} must be unset, empty, or false`),
    );
  });
}

test('rejects development origins', () => {
  assert.throws(
    () => assertReleaseEnvironment({ DUCAT_SNAP_DEV_ORIGINS: 'http://localhost:3000' }),
    /DUCAT_SNAP_DEV_ORIGINS must be unset or empty/,
  );
});

test('CI authenticates GitHub Packages only for trusted runs', () => {
  assert.match(verifyWorkflow, /packages: read/);
  assert.match(verifyWorkflow, /persist-credentials: false/);
  assert.match(verifyWorkflow, /registry-url: https:\/\/npm\.pkg\.github\.com/);
  assert.match(verifyWorkflow, /scope: '@ducat-unit'/);
  assert.match(
    verifyWorkflow,
    /if: github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  );
  assert.match(verifyWorkflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(
    verifyWorkflow,
    /if: github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name != github\.repository/,
  );
  assert.match(verifyWorkflow, /run: npm ci --ignore-scripts/);
});
