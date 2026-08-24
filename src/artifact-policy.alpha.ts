/** @fileoverview Defines the alpha-only compile-time Snap authority. */
import { ducatError } from './errors';
import type { DeploymentId } from './types';

export type SnapArtifactPolicy = 'alpha-mainnet';
export type OperationalSnapArtifactPolicy = SnapArtifactPolicy;

export type SnapArtifactPolicyEvidence = {
  policy: OperationalSnapArtifactPolicy;
  allowed_origins: readonly string[];
  allowed_deployments: readonly DeploymentId[];
  default_deployment: DeploymentId;
  debug_enabled: boolean;
  unprompted_enabled: boolean;
};

const ALPHA_DEPLOYMENTS = Object.freeze([
  'alpha-mainnet',
] as const satisfies readonly DeploymentId[]);
const COMPILED_POLICY = process.env.DUCAT_SNAP_ARTIFACT_POLICY;
const COMPILED_ORIGIN = process.env.DUCAT_SNAP_ALPHA_ORIGIN;
const COMPILED_DEV_ORIGINS = process.env.DUCAT_SNAP_DEV_ORIGINS;
const COMPILED_DEBUG = process.env.DUCAT_SNAP_DEBUG;
const COMPILED_UNPROMPTED = process.env.DUCAT_SNAP_DEV_UNPROMPTED;

function invalidPolicy(message: string, details?: Record<string, unknown>): never {
  throw ducatError('ARTIFACT_POLICY_INVALID', message, details);
}

function alphaOrigin(): string {
  const origin = (COMPILED_ORIGIN ?? '').trim();
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return invalidPolicy('DUCAT_SNAP_ALPHA_ORIGIN must be the exact alpha Admin origin.');
  }
  if (
    url.protocol !== 'http:'
    || url.hostname !== 'localhost'
    || url.port !== '8075'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || url.origin !== origin
  ) {
    return invalidPolicy('DUCAT_SNAP_ALPHA_ORIGIN must be the exact alpha Admin origin.');
  }
  return origin;
}

function disabledFlag(name: 'DUCAT_SNAP_DEBUG' | 'DUCAT_SNAP_DEV_UNPROMPTED'): void {
  const value = (name === 'DUCAT_SNAP_DEBUG'
    ? COMPILED_DEBUG
    : COMPILED_UNPROMPTED
  )?.trim().toLowerCase() ?? '';
  if (value === '' || value === 'false') return;
  return invalidPolicy(`${name} must be false, empty, or unset for the alpha artifact.`, { name });
}

let compiledPolicy: SnapArtifactPolicyEvidence | undefined;

/** @returns Frozen alpha authority compiled into the active Snap artifact. */
export function artifactPolicy(): SnapArtifactPolicyEvidence {
  if (compiledPolicy) return compiledPolicy;
  if (COMPILED_POLICY !== 'alpha-mainnet') {
    return invalidPolicy('The alpha policy module requires DUCAT_SNAP_ARTIFACT_POLICY=alpha-mainnet.');
  }
  if ((COMPILED_DEV_ORIGINS ?? '').trim()) {
    return invalidPolicy('Alpha artifacts must not define DUCAT_SNAP_DEV_ORIGINS.');
  }
  disabledFlag('DUCAT_SNAP_DEBUG');
  disabledFlag('DUCAT_SNAP_DEV_UNPROMPTED');

  compiledPolicy = Object.freeze({
    policy: 'alpha-mainnet',
    allowed_origins: Object.freeze([alphaOrigin()]),
    allowed_deployments: ALPHA_DEPLOYMENTS,
    default_deployment: 'alpha-mainnet',
    debug_enabled: false,
    unprompted_enabled: false,
  });
  return compiledPolicy;
}

/** Rejects every deployment except the canonical alpha identity. */
export function assertDeploymentAvailable(deploymentId: DeploymentId): void {
  if (!artifactPolicy().allowed_deployments.includes(deploymentId)) {
    throw ducatError(
      'DEPLOYMENT_NOT_AVAILABLE',
      `Deployment ${deploymentId} is not available in the alpha-mainnet Snap artifact.`,
      { artifactPolicy: 'alpha-mainnet', deploymentId },
    );
  }
}
