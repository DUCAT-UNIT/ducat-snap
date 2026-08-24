import { readFileSync } from 'node:fs';

const BOOLEAN_RELEASE_FLAGS = ['DUCAT_SNAP_DEV_UNPROMPTED', 'DUCAT_SNAP_DEBUG'];

export const REVIEWED_PRODUCTION_ORIGINS = Object.freeze([
  'https://app.ducatprotocol.com',
  'https://dev.app.ducatprotocol.com',
  'https://staging.app.ducatprotocol.com',
]);

const FORBIDDEN_PRODUCTION_BUNDLE_EVIDENCE = [
  'http://localhost',
  'http://127.0.0.1',
  'http://frontend',
  'http://ducat-admin',
  'ducat_signPsbtUnprompted',
  '[ducat-snap]',
  '.snap/dev',
  'https://validator-mainnet.alpha.ducatprotocol.com',
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
  for (const name of ['ALPHA_MAINNET_VALIDATOR_BASE_URL', 'ALPHA_MAINNET_ESPLORA_BASE_URL']) {
    if ((env[name] ?? '').trim() !== '') {
      throw new Error(`${name} must be unset or empty for a release build.`);
    }
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
      assertProductionBundle(readFileSync('dist/bundle.js', 'utf8'));
      console.log('release-policy: verified production manifest and bundle evidence');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
