import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertProductionBundle,
  assertProductionManifest,
  assertReleaseEnvironment,
  REVIEWED_PRODUCTION_ORIGINS,
} from './release-policy.mjs';
import { parseDevelopmentOrigins } from './dev-origin-policy.mjs';

const trackedManifest = JSON.parse(readFileSync(new URL('../snap.manifest.json', import.meta.url), 'utf8'));

const verifyWorkflow = readFileSync(
  new URL('../.github/workflows/verify.yml', import.meta.url),
  'utf8',
);

test('accepts a clean release environment', () => {
  assert.doesNotThrow(() => assertReleaseEnvironment({}));
  assert.doesNotThrow(() => assertReleaseEnvironment({
    DUCAT_SNAP_ARTIFACT_POLICY: 'production',
    DUCAT_SNAP_DEV_UNPROMPTED: 'false',
    DUCAT_SNAP_DEBUG: '',
    DUCAT_SNAP_DEV_ORIGINS: '  ',
  }));
});

for (const policy of ['development', 'alpha-mainnet', 'preview']) {
  test(`rejects ${policy} artifact policy`, () => {
    assert.throws(
      () => assertReleaseEnvironment({ DUCAT_SNAP_ARTIFACT_POLICY: policy }),
      /DUCAT_SNAP_ARTIFACT_POLICY must be unset or production/,
    );
  });
}

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

test('development build parser accepts only an exact non-empty origin set', () => {
  assert.deepEqual(
    parseDevelopmentOrigins(' http://localhost:3000 , http://localhost:8075 '),
    ['http://localhost:3000', 'http://localhost:8075'],
  );
  for (const value of [
    '',
    ',http://localhost:3000',
    'http://localhost:3000,http://localhost:3000',
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com?query=1',
    'https://example.com#fragment',
    'file:///tmp/ducat',
  ]) {
    assert.throws(() => parseDevelopmentOrigins(value));
  }
});

test('tracked manifest and runtime origins equal the reviewed production set in order', () => {
  assert.deepEqual(
    trackedManifest.initialPermissions['endowment:rpc'].allowedOrigins,
    REVIEWED_PRODUCTION_ORIGINS,
  );
  assert.doesNotThrow(() => assertProductionManifest(trackedManifest, REVIEWED_PRODUCTION_ORIGINS));
});

for (const extraOrigin of ['https://preview.ducatprotocol.com', 'http://localhost:3000']) {
  test(`rejects extra manifest origin ${extraOrigin}`, () => {
    const manifest = structuredClone(trackedManifest);
    manifest.initialPermissions['endowment:rpc'].allowedOrigins.push(extraOrigin);
    assert.throws(() => assertProductionManifest(manifest, REVIEWED_PRODUCTION_ORIGINS), /exact reviewed production origins/);
  });
}

test('rejects manifest and runtime policy disagreement', () => {
  assert.throws(
    () => assertProductionManifest(trackedManifest, REVIEWED_PRODUCTION_ORIGINS.slice(0, 2)),
    /runtime origin policy does not match/,
  );
});

test('accepts strict alpha identity evidence when the production artifact keeps alpha unavailable', () => {
  const bundle = `${REVIEWED_PRODUCTION_ORIGINS.join(' ')} strict decoder alpha-mainnet DEPLOYMENT_NOT_AVAILABLE`;
  assert.doesNotThrow(() => assertProductionBundle(bundle));
});

for (const forbidden of [
  'http://localhost:3000',
  'http://127.0.0.1:8083',
  'http://frontend:3000',
  'http://ducat-admin:8075',
  'ducat_signPsbtUnprompted',
  '[ducat-snap]',
  '.snap/dev',
  '.snap/alpha',
]) {
  test(`rejects production bundle evidence ${forbidden}`, () => {
    const bundle = `${REVIEWED_PRODUCTION_ORIGINS.join(' ')} ${forbidden}`;
    assert.throws(() => assertProductionBundle(bundle), /forbidden production bundle evidence/);
  });
}

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
