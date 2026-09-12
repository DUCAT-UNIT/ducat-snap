import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  assertProductionBundle,
  assertProductionManifest,
  assertProductionProfiles,
  assertReleaseEnvironment,
  REVIEWED_DERIVATION_PATHS,
  REVIEWED_PRODUCTION_ORIGINS,
  REVIEWED_MAINNET_VALIDATOR_URL,
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

for (const policy of ['development', 'preview']) {
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

test('tracked manifest contains the exact reviewed derivation paths in order', () => {
  assert.deepEqual(
    trackedManifest.initialPermissions.snap_getBip32Entropy,
    REVIEWED_DERIVATION_PATHS,
  );
  assert.doesNotThrow(() => assertProductionManifest(trackedManifest));
});

test('rejects every derivation permission set mutation', () => {
  const reviewed = structuredClone(REVIEWED_DERIVATION_PATHS);
  const mutations = [
    reviewed.slice(1),
    [...reviewed, reviewed[0]],
    [reviewed[1], reviewed[0], ...reviewed.slice(2)],
    [{ path: ['m', "84'", "0'"], curve: 'secp256k1' }, ...reviewed.slice(1)],
    [...reviewed, { path: ['m', "44'", "0'", "0'", '0', '0'], curve: 'secp256k1' }],
  ];

  for (const paths of mutations) {
    const manifest = structuredClone(trackedManifest);
    manifest.initialPermissions.snap_getBip32Entropy = paths;
    assert.throws(() => assertProductionManifest(manifest), /exact reviewed derivation paths/);
  }
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

test('accepts the reviewed mainnet contract evidence without treating alpha as a wallet deployment', () => {
  const bundle = `${REVIEWED_PRODUCTION_ORIGINS.join(' ')} ${REVIEWED_MAINNET_VALIDATOR_URL} alpha-mainnet mutiny INVALID_NETWORK`;
  assert.doesNotThrow(() => assertProductionBundle(bundle));
});

test('accepts only the exact ordered production profile set and validator mapping', () => {
  const profiles = JSON.parse(readFileSync(new URL('../src/network-profiles.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => assertProductionProfiles(profiles));

  for (const mutation of [
    { networks: [...profiles.networks, { ...profiles.networks[0], id: 'alpha-mainnet' }] },
    { networks: profiles.networks.map((profile) => profile.id === 'mainnet' ? { ...profile, expected_validator_chain_network: 'mainnet' } : profile) },
    { networks: profiles.networks.map((profile) => profile.id === 'mainnet' ? { ...profile, validator_base_url: 'https://validator-mainnet.example' } : profile) },
  ]) {
    assert.throws(() => assertProductionProfiles(mutation));
  }
});

for (const forbidden of [
  'http://localhost:3000',
  'http://127.0.0.1:8083',
  'http://frontend:3000',
  'http://ducat-admin:8075',
  'ducat_signPsbtUnprompted',
  '[ducat-snap]',
  '.snap/dev',
]) {
  test(`rejects production bundle evidence ${forbidden}`, () => {
    const bundle = `${REVIEWED_PRODUCTION_ORIGINS.join(' ')} ${REVIEWED_MAINNET_VALIDATOR_URL} alpha-mainnet mutiny ${forbidden}`;
    assert.throws(() => assertProductionBundle(bundle), /forbidden production bundle evidence/);
  });
}

for (const missing of [REVIEWED_MAINNET_VALIDATOR_URL, 'alpha-mainnet', 'mutiny']) {
  test(`rejects production bundle missing reviewed network evidence ${missing}`, () => {
    const evidence = [REVIEWED_MAINNET_VALIDATOR_URL, 'alpha-mainnet', 'mutiny']
      .filter((value) => value !== missing)
      .join(' ');
    const bundle = `${REVIEWED_PRODUCTION_ORIGINS.join(' ')} ${evidence}`;
    assert.throws(() => assertProductionBundle(bundle), /missing reviewed network evidence/);
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
