/** @fileoverview Defines the single endpoint profile compiled into the alpha Snap artifact. */
import { normalizeNetworkEndpointUrl } from './network-endpoint-policy';
import { bitcoinNetworkForDeployment, normalizeDeploymentId } from './networks';
import { getState } from './state';
import type { BitcoinNetwork, DeploymentId, NetworkEndpointOverrides } from './types';

export type DeploymentProfile = {
  id: DeploymentId;
  label: string;
  bitcoin_network: BitcoinNetwork;
  validator_base_url: string;
  esplora_base_url: string;
};

export { normalizeNetworkEndpointUrl } from './network-endpoint-policy';

function requiredAlphaBuildInput(name: 'ALPHA_MAINNET_VALIDATOR_BASE_URL' | 'ALPHA_MAINNET_ESPLORA_BASE_URL'): string {
  const value = (name === 'ALPHA_MAINNET_VALIDATOR_BASE_URL'
    ? process.env.ALPHA_MAINNET_VALIDATOR_BASE_URL
    : process.env.ALPHA_MAINNET_ESPLORA_BASE_URL
  )?.trim();
  if (!value) {
    throw new Error(`${name} is required for the alpha-mainnet Snap artifact`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBitcoinNetwork(value: unknown): BitcoinNetwork {
  if (value === 'regtest' || value === 'signet' || value === 'testnet4' || value === 'mainnet') return value;
  throw new Error(`invalid Bitcoin network: ${String(value)}`);
}

/** Validates the one alpha profile using the shared endpoint and identity rules. */
export function validateNetworkProfiles(raw: unknown): DeploymentProfile[] {
  if (!isRecord(raw) || !Array.isArray(raw.networks)) {
    throw new Error('network profiles must include a networks array');
  }
  const seen = new Set<string>();
  const profiles: DeploymentProfile[] = [];
  for (const entry of raw.networks) {
    if (!isRecord(entry)) throw new Error('network profile entries must be objects');
    const id = normalizeDeploymentId(entry.id);
    if (seen.has(id)) throw new Error(`duplicate network profile: ${id}`);
    seen.add(id);
    if (id !== 'alpha-mainnet') continue;
    const bitcoinNetwork = parseBitcoinNetwork(entry.bitcoin_network);
    const expectedBitcoinNetwork = bitcoinNetworkForDeployment(id);
    if (bitcoinNetwork !== expectedBitcoinNetwork) {
      throw new Error(`network profile ${id} must map to Bitcoin ${expectedBitcoinNetwork}`);
    }
    profiles.push({
      id,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id,
      bitcoin_network: bitcoinNetwork,
      validator_base_url: normalizeNetworkEndpointUrl(entry.validator_base_url, 'validator_base_url', bitcoinNetwork),
      esplora_base_url: normalizeNetworkEndpointUrl(entry.esplora_base_url, 'esplora_base_url', bitcoinNetwork),
    });
  }
  return profiles;
}

const PROFILES = validateNetworkProfiles({
  networks: [{
    id: 'alpha-mainnet',
    label: 'alpha-mainnet',
    bitcoin_network: 'mainnet',
    validator_base_url: requiredAlphaBuildInput('ALPHA_MAINNET_VALIDATOR_BASE_URL'),
    esplora_base_url: requiredAlphaBuildInput('ALPHA_MAINNET_ESPLORA_BASE_URL'),
  }],
});

export function networkProfiles(): DeploymentProfile[] {
  return PROFILES;
}

export function networkProfile(networkInput: unknown): DeploymentProfile {
  const network = normalizeDeploymentId(networkInput);
  const profile = PROFILES.find((candidate) => candidate.id === network);
  if (!profile) throw new Error(`network profile not found: ${network}`);
  return profile;
}

export function effectiveNetworkProfile(networkInput: unknown, overrides: NetworkEndpointOverrides = {}): DeploymentProfile {
  const profile = networkProfile(networkInput);
  const override = overrides[profile.id] ?? {};
  return {
    ...profile,
    validator_base_url: override.validator_base_url
      ? normalizeNetworkEndpointUrl(override.validator_base_url, 'validator_base_url', profile.bitcoin_network)
      : profile.validator_base_url,
    esplora_base_url: override.esplora_base_url
      ? normalizeNetworkEndpointUrl(override.esplora_base_url, 'esplora_base_url', profile.bitcoin_network)
      : profile.esplora_base_url,
  };
}

export async function getEffectiveNetworkProfile(networkInput: unknown): Promise<DeploymentProfile> {
  const state = await getState();
  return effectiveNetworkProfile(networkInput, state.networkEndpointOverrides ?? {});
}
