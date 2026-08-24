import type { DeploymentId } from '../types';

const POLICY_ENV = [
  'DUCAT_SNAP_ARTIFACT_POLICY',
  'DUCAT_SNAP_DEV_ORIGINS',
  'DUCAT_SNAP_DEV_UNPROMPTED',
  'DUCAT_SNAP_DEBUG',
] as const;

const RETIRED_REGTEST_FLAG = ['DUCAT', 'SNAP', 'DEV', 'REGTEST'].join('_');
const DEVELOPMENT_ORIGINS = 'http://localhost:3000,http://localhost:8075,http://frontend:3000,http://ducat-admin:8075';

type PolicyModule = typeof import('../artifact-policy');

let savedEnvironment: Record<(typeof POLICY_ENV)[number], string | undefined>;

function loadPolicy(environment: Partial<Record<(typeof POLICY_ENV)[number], string | undefined>>): PolicyModule {
  for (const name of POLICY_ENV) {
    const value = environment[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  jest.resetModules();
  return require('../artifact-policy') as PolicyModule;
}

beforeEach(() => {
  savedEnvironment = Object.fromEntries(POLICY_ENV.map((name) => [name, process.env[name]])) as typeof savedEnvironment;
});

afterEach(() => {
  for (const name of POLICY_ENV) {
    const value = savedEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  jest.resetModules();
});

describe('compiled Snap artifact policy', () => {
  it('defines the exact production authority', () => {
    const { artifactPolicy } = loadPolicy({ DUCAT_SNAP_ARTIFACT_POLICY: 'production' });

    expect(artifactPolicy()).toEqual({
      policy: 'production',
      allowed_origins: [
        'https://app.ducatprotocol.com',
        'https://dev.app.ducatprotocol.com',
        'https://staging.app.ducatprotocol.com',
      ],
      allowed_deployments: ['mainnet', 'signet', 'mutinynet', 'testnet4'],
      default_deployment: 'mutinynet',
      debug_enabled: false,
      unprompted_enabled: false,
    });
  });

  it('defines development authority without inheriting production origins', () => {
    const { artifactPolicy } = loadPolicy({
      DUCAT_SNAP_ARTIFACT_POLICY: 'development',
      DUCAT_SNAP_DEV_ORIGINS: ' http://localhost:3000 , http://localhost:8075 , http://frontend:3000 , http://ducat-admin:8075 ',
      DUCAT_SNAP_DEBUG: 'true',
      DUCAT_SNAP_DEV_UNPROMPTED: 'true',
    });

    expect(artifactPolicy()).toEqual({
      policy: 'development',
      allowed_origins: ['http://localhost:3000', 'http://localhost:8075', 'http://frontend:3000', 'http://ducat-admin:8075'],
      allowed_deployments: ['regtest', 'signet', 'mutinynet', 'testnet4', 'alpha-mainnet', 'mainnet'],
      default_deployment: 'mutinynet',
      debug_enabled: true,
      unprompted_enabled: true,
    });
  });

  it.each([
    ['production', 'regtest'],
    ['production', 'alpha-mainnet'],
  ] as const)('%s rejects unavailable deployment %s', (policy, deployment) => {
    const { assertDeploymentAvailable } = loadPolicy({
      DUCAT_SNAP_ARTIFACT_POLICY: policy,
    });

    expect(() => assertDeploymentAvailable(deployment)).toThrow(expect.objectContaining({
      code: 'DEPLOYMENT_NOT_AVAILABLE',
    }));
  });

  it('development admits every canonical deployment', () => {
    const { assertDeploymentAvailable } = loadPolicy({
      DUCAT_SNAP_ARTIFACT_POLICY: 'development',
      DUCAT_SNAP_DEV_ORIGINS: DEVELOPMENT_ORIGINS,
    });

    for (const deployment of ['regtest', 'signet', 'mutinynet', 'testnet4', 'alpha-mainnet', 'mainnet'] satisfies DeploymentId[]) {
      expect(() => assertDeploymentAvailable(deployment)).not.toThrow();
    }
  });

  it.each([undefined, '', 'preview', 'alpha', 'alpha-mainnet'])('rejects missing or unknown policy selector: %p', (selector) => {
    const module = loadPolicy({ DUCAT_SNAP_ARTIFACT_POLICY: selector });

    expect(() => module.artifactPolicy()).toThrow(expect.objectContaining({
      code: 'ARTIFACT_POLICY_INVALID',
    }));
  });

  it.each([
    'http://localhost:3000,http://localhost:3000',
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com?query=1',
    'https://example.com#fragment',
    'file:///tmp/ducat',
    'not an origin',
    ',http://localhost:3000',
  ])('rejects malformed development origin input: %s', (origins) => {
    const module = loadPolicy({
      DUCAT_SNAP_ARTIFACT_POLICY: 'development',
      DUCAT_SNAP_DEV_ORIGINS: origins,
    });

    expect(() => module.artifactPolicy()).toThrow(expect.objectContaining({
      code: 'ARTIFACT_POLICY_INVALID',
    }));
  });

  it('rejects development-only inputs under production policy', () => {
    const module = loadPolicy({
      DUCAT_SNAP_ARTIFACT_POLICY: 'production',
      DUCAT_SNAP_DEV_ORIGINS: 'http://localhost:3000',
    });

    expect(() => module.artifactPolicy()).toThrow(expect.objectContaining({
      code: 'ARTIFACT_POLICY_INVALID',
    }));
  });

  it('cannot be enlarged by the retired regtest flag', () => {
    const saved = process.env[RETIRED_REGTEST_FLAG];
    try {
      process.env[RETIRED_REGTEST_FLAG] = 'true';
      const production = loadPolicy({ DUCAT_SNAP_ARTIFACT_POLICY: 'production' }).artifactPolicy();
      process.env[RETIRED_REGTEST_FLAG] = 'false';
      const development = loadPolicy({
        DUCAT_SNAP_ARTIFACT_POLICY: 'development',
        DUCAT_SNAP_DEV_ORIGINS: DEVELOPMENT_ORIGINS,
      }).artifactPolicy();

      expect(production.allowed_deployments).not.toContain('regtest');
      expect(development.allowed_deployments).toContain('regtest');
    } finally {
      if (saved === undefined) delete process.env[RETIRED_REGTEST_FLAG];
      else process.env[RETIRED_REGTEST_FLAG] = saved;
    }
  });

  it('decodes one immutable policy per compiled module instance', () => {
    const module = loadPolicy({ DUCAT_SNAP_ARTIFACT_POLICY: 'production' });
    const production = module.artifactPolicy();

    process.env.DUCAT_SNAP_ARTIFACT_POLICY = 'development';
    process.env.DUCAT_SNAP_DEV_ORIGINS = DEVELOPMENT_ORIGINS;

    expect(module.artifactPolicy()).toBe(production);
    expect(module.artifactPolicy().policy).toBe('production');
    expect(() => module.assertDeploymentAvailable('regtest')).toThrow(expect.objectContaining({
      code: 'DEPLOYMENT_NOT_AVAILABLE',
    }));
  });
});
