/** @fileoverview Validates bundled endpoint profiles and overlays sanitized state-held endpoint overrides. */
import bundledProfiles from './network-profiles.json';
import { normalizeNetworkEndpointUrl } from './network-endpoint-policy';
import { DUCAT_SUPPORTED_NETWORKS, normalizeNetwork } from './networks';
import { getState } from './state';
import type { DucatNetwork, NetworkEndpointOverrides } from './types';

export type NetworkProfile = {
  id: DucatNetwork;
  label: string;
  validator_base_url: string;
  esplora_base_url: string;
};

export { normalizeNetworkEndpointUrl } from './network-endpoint-policy';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProfileId(value: unknown): DucatNetwork {
  if (value === 'regtest') {
    return 'regtest';
  }

  return normalizeNetwork(value);
}

/**
 * Decodes bundled endpoint profiles and rejects malformed or duplicate entries.
 * @param raw - Untrusted imported profile document.
 * @returns Supported profiles with canonical IDs and transport-validated URLs.
 * @throws When the document or any supported profile is invalid.
 */
export function validateNetworkProfiles(raw: unknown): NetworkProfile[] {
  if (!isRecord(raw) || !Array.isArray(raw.networks)) {
    throw new Error('network profiles must include a networks array');
  }

  const seen = new Set<string>();
  const supported = new Set(DUCAT_SUPPORTED_NETWORKS);
  const profiles: NetworkProfile[] = [];

  for (const entry of raw.networks) {
    if (!isRecord(entry)) {
      throw new Error('network profile entries must be objects');
    }
    const candidate = entry;
    const id = normalizeProfileId(candidate.id);
    if (seen.has(id)) {
      throw new Error(`duplicate network profile: ${id}`);
    }
    seen.add(id);

    if (!supported.has(id)) {
      continue;
    }

    profiles.push({
      id,
      label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : id,
      validator_base_url: normalizeNetworkEndpointUrl(candidate.validator_base_url, 'validator_base_url', id),
      esplora_base_url: normalizeNetworkEndpointUrl(candidate.esplora_base_url, 'esplora_base_url', id),
    });
  }

  return profiles;
}

const PROFILES = validateNetworkProfiles(bundledProfiles);

/** @returns The validated bundled network profile list. */
export function networkProfiles(): NetworkProfile[] {
  return PROFILES;
}

/**
 * Resolves one bundled endpoint profile from a network name or alias.
 * @param networkInput - Untrusted network identifier.
 * @returns Matching canonical profile.
 * @throws When the network is unsupported or has no bundled profile.
 */
export function networkProfile(networkInput: unknown): NetworkProfile {
  const network = normalizeNetwork(networkInput);
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
export function effectiveNetworkProfile(networkInput: unknown, overrides: NetworkEndpointOverrides = {}): NetworkProfile {
  const profile = networkProfile(networkInput);
  const override = overrides[profile.id] ?? {};

  return {
    ...profile,
    validator_base_url: override.validator_base_url ? normalizeNetworkEndpointUrl(override.validator_base_url, 'validator_base_url', profile.id) : profile.validator_base_url,
    esplora_base_url: override.esplora_base_url ? normalizeNetworkEndpointUrl(override.esplora_base_url, 'esplora_base_url', profile.id) : profile.esplora_base_url,
  };
}

/**
 * Loads sanitized Snap state and resolves the effective endpoint profile.
 * @param networkInput - Untrusted network identifier.
 * @returns Effective profile with verified persisted overrides.
 */
export async function getEffectiveNetworkProfile(networkInput: unknown): Promise<NetworkProfile> {
  const state = await getState();
  return effectiveNetworkProfile(networkInput, state.networkEndpointOverrides ?? {});
}
