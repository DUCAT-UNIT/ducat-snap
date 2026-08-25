/** @fileoverview Validates bundled endpoint profiles and overlays sanitized state-held endpoint overrides. */
import bundledProfiles from './network-profiles.json';
import { artifactPolicy } from './artifact-policy';
import { normalizeNetworkEndpointUrl } from './network-endpoint-policy';
import { bitcoinNetworkForDeployment, normalizeDeploymentId } from './networks';
import { getState } from './state';
import type { BitcoinNetwork, DeploymentId, NetworkEndpointOverrides } from './types';

const bundledProfile = (id: DeploymentId): unknown => {
  const profile = bundledProfiles.networks.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`missing bundled network profile: ${id}`);
  return profile;
};

const COMPILED_PROFILES = process.env.DUCAT_SNAP_ARTIFACT_POLICY === 'development'
  ? {
      networks: [
        {
          id: 'regtest',
          label: 'Regtest',
          bitcoin_network: 'regtest',
          expected_validator_chain_network: 'regtest',
          validator_base_url: 'http://localhost:8083',
          esplora_base_url: 'http://localhost:3002',
        },
        bundledProfile('mainnet'),
        bundledProfile('mutinynet'),
      ],
    }
  : bundledProfiles;

export type DeploymentProfile = {
  id: DeploymentId;
  label: string;
  bitcoin_network: BitcoinNetwork;
  expected_validator_chain_network: string;
  validator_base_url: string;
  esplora_base_url: string;
};

export { normalizeNetworkEndpointUrl } from './network-endpoint-policy';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBitcoinNetwork(value: unknown): BitcoinNetwork {
  if (value === 'regtest' || value === 'signet' || value === 'mainnet') {
    return value;
  }

  throw new Error(`invalid Bitcoin network: ${String(value)}`);
}

function parseExpectedValidatorChainNetwork(value: unknown): string {
  if (typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    return value;
  }

  throw new Error(`invalid expected validator chain_network: ${String(value)}`);
}

/**
 * Decodes bundled endpoint profiles and rejects malformed or duplicate entries.
 * @param raw - Untrusted imported profile document.
 * @returns Supported profiles with canonical IDs and transport-validated URLs.
 * @throws When the document or any supported profile is invalid.
 */
export function validateNetworkProfiles(raw: unknown): DeploymentProfile[] {
  if (!isRecord(raw) || !Array.isArray(raw.networks)) {
    throw new Error('network profiles must include a networks array');
  }

  const seen = new Set<string>();
  const supported = new Set<string>(artifactPolicy().allowed_deployments);
  const profiles: DeploymentProfile[] = [];

  for (const entry of raw.networks) {
    if (!isRecord(entry)) {
      throw new Error('network profile entries must be objects');
    }
    const candidate = entry;
    const id = normalizeDeploymentId(candidate.id);
    if (seen.has(id)) {
      throw new Error(`duplicate network profile: ${id}`);
    }
    seen.add(id);

    if (!supported.has(id)) {
      continue;
    }

    const bitcoinNetwork = parseBitcoinNetwork(candidate.bitcoin_network);
    const expectedBitcoinNetwork = bitcoinNetworkForDeployment(id);
    if (bitcoinNetwork !== expectedBitcoinNetwork) {
      throw new Error(`network profile ${id} must map to Bitcoin ${expectedBitcoinNetwork}`);
    }

    profiles.push({
      id,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : id,
      bitcoin_network: bitcoinNetwork,
      expected_validator_chain_network: parseExpectedValidatorChainNetwork(candidate.expected_validator_chain_network),
      validator_base_url: normalizeNetworkEndpointUrl(candidate.validator_base_url, 'validator_base_url', bitcoinNetwork),
      esplora_base_url: normalizeNetworkEndpointUrl(candidate.esplora_base_url, 'esplora_base_url', bitcoinNetwork),
    });
  }

  return profiles;
}

const PROFILES = validateNetworkProfiles(COMPILED_PROFILES);

/** @returns The validated bundled network profile list. */
export function networkProfiles(): DeploymentProfile[] {
  return PROFILES;
}

/**
 * Resolves one bundled endpoint profile from a network name or alias.
 * @param networkInput - Untrusted network identifier.
 * @returns Matching canonical profile.
 * @throws When the network is unsupported or has no bundled profile.
 */
export function networkProfile(networkInput: unknown): DeploymentProfile {
  const network = normalizeDeploymentId(networkInput);
  const profile = PROFILES.find((candidate) => candidate.id === network);
  if (!profile) {
    throw new Error(`network profile not found: ${network}`);
  }
  return profile;
}

/**
 * Overlays verified endpoint overrides and re-applies transport validation.
 * @param networkInput - Untrusted network identifier.
 * @param overrides - Sanitized state-held endpoint overrides.
 * @returns Effective network profile used by wallet operations.
 */
export function effectiveNetworkProfile(networkInput: unknown, overrides: NetworkEndpointOverrides = {}): DeploymentProfile {
  const profile = networkProfile(networkInput);
  const override = overrides[profile.id] ?? {};

  return {
    ...profile,
    validator_base_url: override.validator_base_url ? normalizeNetworkEndpointUrl(override.validator_base_url, 'validator_base_url', profile.bitcoin_network) : profile.validator_base_url,
    esplora_base_url: override.esplora_base_url ? normalizeNetworkEndpointUrl(override.esplora_base_url, 'esplora_base_url', profile.bitcoin_network) : profile.esplora_base_url,
  };
}

/**
 * Loads sanitized Snap state and resolves the effective endpoint profile.
 * @param networkInput - Untrusted network identifier.
 * @returns Effective profile with verified persisted overrides.
 */
export async function getEffectiveNetworkProfile(networkInput: unknown): Promise<DeploymentProfile> {
  const state = await getState();
  return effectiveNetworkProfile(networkInput, state.networkEndpointOverrides ?? {});
}
