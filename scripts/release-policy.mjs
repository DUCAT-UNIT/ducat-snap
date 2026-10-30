import { readFileSync } from 'node:fs';

const BOOLEAN_RELEASE_FLAGS = ['DUCAT_SNAP_DEV_UNPROMPTED', 'DUCAT_SNAP_DEBUG'];

export const REVIEWED_PRODUCTION_ORIGINS = Object.freeze([
  'https://app.ducatprotocol.com',
  'https://dev.app.ducatprotocol.com',
  'https://staging.app.ducatprotocol.com',
]);

export const REVIEWED_PRODUCTION_PROFILE_IDS = Object.freeze(['mainnet', 'mutinynet']);
export const REVIEWED_DERIVATION_PATHS = Object.freeze([
  Object.freeze({ path: Object.freeze(['m', "84'", "0'", "0'", '0', '0']), curve: 'secp256k1' }),
  Object.freeze({ path: Object.freeze(['m', "86'", "0'", "0'", '0', '0']), curve: 'secp256k1' }),
  Object.freeze({ path: Object.freeze(['m', "86'", "0'", "0'", '2', '0']), curve: 'secp256k1' }),
  Object.freeze({ path: Object.freeze(['m', "84'", "1'", "0'", '0', '0']), curve: 'secp256k1' }),
  Object.freeze({ path: Object.freeze(['m', "86'", "1'", "0'", '0', '0']), curve: 'secp256k1' }),
  Object.freeze({ path: Object.freeze(['m', "86'", "1'", "0'", '2', '0']), curve: 'secp256k1' }),
]);
export const REVIEWED_VALIDATOR_CHAIN_NETWORKS = Object.freeze({
  mainnet: 'alpha-mainnet',
  mutinynet: 'mutiny',
});
export const REVIEWED_MAINNET_VALIDATOR_URL = 'https://validator-mainnet.alpha.ducatprotocol.com';

const REQUIRED_PRODUCTION_BUNDLE_EVIDENCE = [
  REVIEWED_MAINNET_VALIDATOR_URL,
  REVIEWED_VALIDATOR_CHAIN_NETWORKS.mainnet,
  REVIEWED_VALIDATOR_CHAIN_NETWORKS.mutinynet,
];

const FORBIDDEN_PRODUCTION_BUNDLE_EVIDENCE = [
  'http://localhost',
  'http://127.0.0.1',
  'http://frontend',
  'http://ducat-admin',
  'ducat_signPsbtUnprompted',
  '[ducat-snap]',
  '.snap/dev',
];

export function assertReleaseEnvironment(env = process.env) {
  const artifactPolicy = (env.DUCAT_SNAP_ARTIFACT_POLICY ?? '').trim();
  if (artifactPolicy !== '' && artifactPolicy !== 'production') {
    throw new Error('DUCAT_SNAP_ARTIFACT_POLICY must be unset or production for a release build.');
  }

  for (const name of BOOLEAN_RELEASE_FLAGS) {
    const value = env[name]?.trim().toLowerCase();
    if (value !== undefined && value !== '' && value !== 'false') {
      throw new Error(`${name} must be unset, empty, or false for a release build.`);
    }
  }

  if ((env.DUCAT_SNAP_DEV_ORIGINS ?? '').trim() !== '') {
    throw new Error('DUCAT_SNAP_DEV_ORIGINS must be unset or empty for a release build.');
  }
}

function exactOrigins(value, label) {
  if (!Array.isArray(value) || !value.every((origin) => typeof origin === 'string')) {
    throw new Error(`${label} must be an origin array.`);
  }
  return value;
}

export function assertProductionManifest(manifest, runtimeOrigins = REVIEWED_PRODUCTION_ORIGINS) {
  const manifestOrigins = exactOrigins(
    manifest?.initialPermissions?.['endowment:rpc']?.allowedOrigins,
    'manifest origin policy',
  );
  const runtime = exactOrigins(runtimeOrigins, 'runtime origin policy');
  if (JSON.stringify(manifestOrigins) !== JSON.stringify(REVIEWED_PRODUCTION_ORIGINS)) {
    throw new Error('manifest must contain the exact reviewed production origins in order.');
  }
  if (JSON.stringify(runtime) !== JSON.stringify(REVIEWED_PRODUCTION_ORIGINS)) {
    throw new Error('runtime origin policy does not match the reviewed production origins.');
  }
  if (JSON.stringify(manifest?.initialPermissions?.snap_getBip32Entropy) !== JSON.stringify(REVIEWED_DERIVATION_PATHS)) {
    throw new Error('manifest must contain the exact reviewed derivation paths in order.');
  }
}

export function assertProductionProfiles(profileDocument) {
  const profiles = profileDocument?.networks;
  if (!Array.isArray(profiles)) {
    throw new Error('production network profiles must contain a networks array.');
  }
  const ids = profiles.map((profile) => profile?.id);
  if (JSON.stringify(ids) !== JSON.stringify(REVIEWED_PRODUCTION_PROFILE_IDS)) {
    throw new Error('production network profiles must contain exactly mainnet and mutinynet in order.');
  }
  for (const profile of profiles) {
    const expected = REVIEWED_VALIDATOR_CHAIN_NETWORKS[profile.id];
    if (profile.expected_validator_chain_network !== expected) {
      throw new Error(`production profile ${profile.id} must expect validator chain_network ${expected}.`);
    }
  }
  if (profiles[0]?.validator_base_url !== REVIEWED_MAINNET_VALIDATOR_URL) {
    throw new Error(`production mainnet profile must use ${REVIEWED_MAINNET_VALIDATOR_URL}.`);
  }
}

export function assertProductionBundle(bundle) {
  if (typeof bundle !== 'string' || bundle.length === 0) {
    throw new Error('production bundle must be non-empty text');
  }
  for (const origin of REVIEWED_PRODUCTION_ORIGINS) {
    if (!bundle.includes(origin)) {
      throw new Error(`production bundle is missing reviewed origin: ${origin}`);
    }
  }
  for (const evidence of REQUIRED_PRODUCTION_BUNDLE_EVIDENCE) {
    if (!bundle.includes(evidence)) {
      throw new Error(`production bundle is missing reviewed network evidence: ${evidence}`);
    }
  }
  for (const evidence of FORBIDDEN_PRODUCTION_BUNDLE_EVIDENCE) {
    if (bundle.includes(evidence)) {
      throw new Error(`forbidden production bundle evidence: ${evidence}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    assertReleaseEnvironment();
    if (process.argv[2] === '--verify-artifacts') {
      const manifest = JSON.parse(readFileSync('snap.manifest.json', 'utf8'));
      assertProductionManifest(manifest);
      assertProductionProfiles(JSON.parse(readFileSync('src/network-profiles.json', 'utf8')));
      assertProductionBundle(readFileSync('dist/bundle.js', 'utf8'));
      console.log('release-policy: verified production manifest and bundle evidence');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
