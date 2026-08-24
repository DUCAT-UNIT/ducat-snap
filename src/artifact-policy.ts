/** @fileoverview Decodes immutable compile-time Snap artifact authority and deployment availability. */
import { ducatError } from './errors';
import { bitcoinNetworkForDeployment } from './networks';
import type { DeploymentId } from './types';

export type SnapArtifactPolicy = 'production' | 'development' | 'alpha-mainnet';

export type OperationalSnapArtifactPolicy = Exclude<SnapArtifactPolicy, 'alpha-mainnet'>;

export type SnapArtifactPolicyEvidence = {
  policy: OperationalSnapArtifactPolicy;
  allowed_origins: readonly string[];
  allowed_deployments: readonly DeploymentId[];
  default_deployment: DeploymentId;
  debug_enabled: boolean;
  unprompted_enabled: boolean;
};

export const PRODUCTION_ALLOWED_ORIGINS = Object.freeze([
  'https://app.ducatprotocol.com',
  'https://dev.app.ducatprotocol.com',
  'https://staging.app.ducatprotocol.com',
] as const);

const PRODUCTION_DEPLOYMENTS = Object.freeze([
  'mainnet',
  'signet',
  'mutinynet',
  'testnet4',
] as const satisfies readonly DeploymentId[]);

const DEVELOPMENT_DEPLOYMENTS = Object.freeze([
  'regtest',
  'signet',
  'mutinynet',
  'testnet4',
] as const satisfies readonly DeploymentId[]);

function invalidPolicy(message: string, details?: Record<string, unknown>): never {
  throw ducatError('ARTIFACT_POLICY_INVALID', message, details);
}

function booleanFlag(name: 'DUCAT_SNAP_DEBUG' | 'DUCAT_SNAP_DEV_UNPROMPTED'): boolean {
  const value = (name === 'DUCAT_SNAP_DEBUG'
    ? process.env.DUCAT_SNAP_DEBUG
    : process.env.DUCAT_SNAP_DEV_UNPROMPTED
  )?.trim().toLowerCase() ?? '';
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  return invalidPolicy(`${name} must be true, false, empty, or unset.`, { name });
}

function developmentOrigins(): readonly string[] {
  const raw = process.env.DUCAT_SNAP_DEV_ORIGINS ?? '';
  if (!raw.trim()) {
    return invalidPolicy('DUCAT_SNAP_DEV_ORIGINS must contain at least one exact development origin.');
  }

  const origins: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const origin = entry.trim();
    if (!origin) {
      return invalidPolicy('DUCAT_SNAP_DEV_ORIGINS must not contain empty entries.');
    }

    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return invalidPolicy(`Invalid development origin: ${origin}`);
    }

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== '/'
      || url.origin !== origin
    ) {
      return invalidPolicy(`Development origin must be an exact credential-free HTTP(S) origin: ${origin}`);
    }
    if (seen.has(origin)) {
      return invalidPolicy(`Duplicate development origin: ${origin}`);
    }
    seen.add(origin);
    origins.push(origin);
  }

  return Object.freeze(origins);
}

function selectedPolicy(): OperationalSnapArtifactPolicy {
  const value = process.env.DUCAT_SNAP_ARTIFACT_POLICY;
  if (value === 'alpha-mainnet') {
    throw ducatError(
      'ARTIFACT_POLICY_NOT_IMPLEMENTED',
      'The alpha-mainnet Snap artifact policy is reserved and not implemented in Phase 1.',
    );
  }
  if (value === 'production' || value === 'development') return value;
  return invalidPolicy('DUCAT_SNAP_ARTIFACT_POLICY must be production or development.', { artifactPolicy: value });
}

let compiledPolicy: SnapArtifactPolicyEvidence | undefined;

/** @returns Frozen evidence compiled into the active Snap artifact. */
export function artifactPolicy(): SnapArtifactPolicyEvidence {
  if (compiledPolicy) return compiledPolicy;

  const policy = selectedPolicy();
  const debugEnabled = booleanFlag('DUCAT_SNAP_DEBUG');
  const unpromptedEnabled = booleanFlag('DUCAT_SNAP_DEV_UNPROMPTED');

  if (policy === 'production') {
    if ((process.env.DUCAT_SNAP_DEV_ORIGINS ?? '').trim()) {
      return invalidPolicy('Production artifacts must not define DUCAT_SNAP_DEV_ORIGINS.');
    }
    if (debugEnabled || unpromptedEnabled) {
      return invalidPolicy('Production artifacts must disable debug and unprompted signing.');
    }
    compiledPolicy = Object.freeze({
      policy,
      allowed_origins: PRODUCTION_ALLOWED_ORIGINS,
      allowed_deployments: PRODUCTION_DEPLOYMENTS,
      default_deployment: 'mutinynet',
      debug_enabled: false,
      unprompted_enabled: false,
    });
    return compiledPolicy;
  }

  compiledPolicy = Object.freeze({
    policy,
    allowed_origins: developmentOrigins(),
    allowed_deployments: DEVELOPMENT_DEPLOYMENTS,
    default_deployment: 'regtest',
    debug_enabled: debugEnabled,
    unprompted_enabled: unpromptedEnabled,
  });
  return compiledPolicy;
}

/**
 * Rejects deployments outside the authority compiled into this artifact.
 * @param deploymentId - Canonical requested deployment.
 * @throws Before callers perform any wallet-side effect when unavailable.
 */
export function assertDeploymentAvailable(deploymentId: DeploymentId): void {
  const evidence = artifactPolicy();
  const mainnetBackedDevelopment = evidence.policy === 'development'
    && bitcoinNetworkForDeployment(deploymentId) === 'mainnet';
  if (mainnetBackedDevelopment || !evidence.allowed_deployments.includes(deploymentId)) {
    throw ducatError(
      'DEPLOYMENT_NOT_AVAILABLE',
      `Deployment ${deploymentId} is not available in the ${evidence.policy} Snap artifact.`,
      { artifactPolicy: evidence.policy, deploymentId },
    );
  }
}
