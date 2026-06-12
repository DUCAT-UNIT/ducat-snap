import { networks, type Network } from 'bitcoinjs-lib';

import type { DucatNetwork } from './types';

export const DUCAT_APP_URL = 'https://app.ducatprotocol.com';

const ESPLORA_ENDPOINTS: Record<DucatNetwork, string> = {
  signet: 'https://mempool.space/signet/api',
  mutinynet: 'https://mutinynet.com/api',
};

const VALIDATOR_ENDPOINTS: Record<DucatNetwork, string[]> = {
  signet: ['https://validator.ducatprotocol.com', 'https://validator.staging.ducatprotocol.com'],
  mutinynet: ['https://validator.staging.ducatprotocol.com'],
};

export function normalizeNetwork(network: unknown): DucatNetwork {
  if (network === 'signet') {
    return 'signet';
  }

  if (network === 'mutiny' || network === 'mutinynet') {
    return 'mutinynet';
  }

  throw new Error('Ducat Snap v1 supports signet and mutinynet only.');
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

export function btcUnit(network: DucatNetwork): string {
  return network === 'signet' ? 'sBTC' : 'mBTC';
}
