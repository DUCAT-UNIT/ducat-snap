import { networks, type Network } from 'bitcoinjs-lib';

import { ducatError } from './errors';
import type { DucatNetwork } from './types';

export const DUCAT_APP_URL = 'https://app.ducatprotocol.com';

export const DUCAT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'https://app.ducatprotocol.com',
  'https://dev.app.ducatprotocol.com',
  'https://staging.app.ducatprotocol.com',
] as const;

const ESPLORA_ENDPOINTS: Record<DucatNetwork, string> = {
  signet: 'https://mempool.space/signet/api',
  mutinynet: 'https://mutinynet.com/api',
};

const DUCAT_DEV_VALIDATOR_URL = 'https://validator.dev.ducatprotocol.com';

const VALIDATOR_ENDPOINTS: Record<DucatNetwork, string[]> = {
  signet: [DUCAT_DEV_VALIDATOR_URL],
  mutinynet: [DUCAT_DEV_VALIDATOR_URL],
};

export function normalizeNetwork(network: unknown): DucatNetwork {
  if (network === 'signet') {
    return 'signet';
  }

  if (network === 'mutiny' || network === 'mutinynet') {
    return 'mutinynet';
  }

  throw ducatError('INVALID_NETWORK', 'Ducat Snap v1 supports signet and mutinynet only.', {
    requestedNetwork: network,
  });
}

export function bitcoinNetwork(_: DucatNetwork): Network {
  return networks.testnet;
}

export function esploraUrl(network: DucatNetwork): string {
  return ESPLORA_ENDPOINTS[network];
}

export function validatorUrls(network: DucatNetwork): string[] {
  return VALIDATOR_ENDPOINTS[network];
}

export function ducatAppUrl(origin?: string): string {
  if (!origin) {
    return DUCAT_APP_URL;
  }

  try {
    const url = new URL(origin);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin;
    }
  } catch {
    return DUCAT_APP_URL;
  }

  return DUCAT_APP_URL;
}
