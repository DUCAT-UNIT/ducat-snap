import {
  effectiveNetworkProfile,
  networkProfile,
  networkProfiles,
  validateNetworkProfiles,
} from '../network-profiles';
import { verifyDeploymentEndpointIdentity } from '../network-endpoint-policy';
import {
  bitcoinNetworkForDeployment,
  DUCAT_GUARDIAN_PUBKEYS,
  guardianKeyPolicyReady,
  isKnownGuardianPubkey,
  normalizeDeploymentId,
} from '../networks';

describe('deployment and Bitcoin identity', () => {
  it('preserves deployment identity while mapping chain mechanics explicitly', () => {
    expect(normalizeDeploymentId('alpha-mainnet')).toBe('alpha-mainnet');
    expect(normalizeDeploymentId('main')).toBe('mainnet');
    expect(normalizeDeploymentId('mutiny')).toBe('mutinynet');
    expect(bitcoinNetworkForDeployment('alpha-mainnet')).toBe('mainnet');
    expect(bitcoinNetworkForDeployment('mainnet')).toBe('mainnet');
    expect(bitcoinNetworkForDeployment('mutinynet')).toBe('signet');
  });

  it.each([undefined, null, '', 'alpha', 'unknown'])('rejects unknown deployment identifiers: %p', (value) => {
    expect(() => normalizeDeploymentId(value)).toThrow();
  });
});

describe('network profiles', () => {
  it('carries an explicit, correct Bitcoin network for every bundled deployment', () => {
    for (const profile of networkProfiles()) {
      expect(profile.bitcoin_network).toBe(bitcoinNetworkForDeployment(profile.id));
    }
  });

  it('loads one bundled profile per supported network', () => {
    const profiles = validateNetworkProfiles({
      networks: [
        {
          id: 'signet',
          label: 'Signet',
          bitcoin_network: 'signet',
          validator_base_url: 'https://validator-testnet4.dev.ducatprotocol.com',
          esplora_base_url: 'https://mempool.space/signet/api',
        },
      ],
    });

    expect(profiles).toEqual([
      expect.objectContaining({
        id: 'signet',
        bitcoin_network: 'signet',
        validator_base_url: 'https://validator-testnet4.dev.ducatprotocol.com',
        esplora_base_url: 'https://mempool.space/signet/api',
      }),
    ]);
  });

  it('rejects duplicate network ids', () => {
    expect(() => validateNetworkProfiles({
      networks: [
        { id: 'signet', label: 'A', bitcoin_network: 'signet', validator_base_url: 'https://validator-a.example', esplora_base_url: 'https://esplora-a.example' },
        { id: 'signet', label: 'B', bitcoin_network: 'signet', validator_base_url: 'https://validator-b.example', esplora_base_url: 'https://esplora-b.example' },
      ],
    })).toThrow('duplicate network profile: signet');
  });

  it('rejects absent or inconsistent Bitcoin-network mappings', () => {
    expect(() => validateNetworkProfiles({
      networks: [
        { id: 'signet', label: 'Signet', validator_base_url: 'https://validator.example', esplora_base_url: 'https://esplora.example' },
      ],
    })).toThrow('invalid Bitcoin network');

    expect(() => validateNetworkProfiles({
      networks: [
        { id: 'mutinynet', label: 'Mutinynet', bitcoin_network: 'mainnet', validator_base_url: 'https://validator.example', esplora_base_url: 'https://esplora.example' },
      ],
    })).toThrow('network profile mutinynet must map to Bitcoin signet');
  });

  it('rejects malformed profile containers and entries', () => {
    expect(() => validateNetworkProfiles(null)).toThrow('network profiles must include a networks array');
    expect(() => validateNetworkProfiles({ networks: [null] })).toThrow('network profile entries must be objects');
    expect(() => validateNetworkProfiles({ networks: ['signet'] })).toThrow('network profile entries must be objects');
  });

  it('rejects non-http endpoint URLs', () => {
    expect(() => validateNetworkProfiles({
      networks: [
        { id: 'signet', label: 'Signet', bitcoin_network: 'signet', validator_base_url: 'file:///tmp/validator', esplora_base_url: 'https://mempool.space/signet/api' },
      ],
    })).toThrow('validator_base_url must be an HTTP(S) URL');
  });

  it('resolves bundled endpoints for a network', () => {
    const profile = networkProfile('signet');

    expect(profile.validator_base_url).toBe('https://validator-testnet4.dev.ducatprotocol.com');
    expect(profile.esplora_base_url).toBe('https://mempool.space/signet/api');
  });

  it('applies explicit overrides over bundled endpoints', () => {
    const profile = effectiveNetworkProfile('signet', {
      signet: {
        validator_base_url: 'https://validator-override.example',
        esplora_base_url: 'https://esplora-override.example/api',
      },
    });

    expect(profile.validator_base_url).toBe('https://validator-override.example');
    expect(profile.esplora_base_url).toBe('https://esplora-override.example/api');
  });

  it('allows plaintext HTTP only for regtest loopback endpoints', () => {
    expect(() => effectiveNetworkProfile('signet', {
      signet: { validator_base_url: 'http://validator.example' },
    })).toThrow('validator_base_url must use HTTPS outside regtest loopback development');
    expect(() => effectiveNetworkProfile('regtest', {
      regtest: { validator_base_url: 'http://validator.example' },
    })).toThrow('validator_base_url must use HTTPS outside regtest loopback development');

    expect(effectiveNetworkProfile('regtest', {
      regtest: { validator_base_url: 'http://127.0.0.1:8083/' },
    }).validator_base_url).toBe('http://127.0.0.1:8083');
  });

  it('verifies validator and Esplora network identity', async () => {
    await expect(verifyDeploymentEndpointIdentity('signet', 'signet', 'validator', 'https://validator.example',
      jest.fn(async () => Response.json([])) as typeof fetch,
    )).rejects.toThrow('validator endpoint is not on signet');

    await expect(verifyDeploymentEndpointIdentity('signet', 'signet', 'validator', 'https://validator.example',
      jest.fn(async () => Response.json({ chain_network: 'testnet4' })) as typeof fetch,
    )).rejects.toThrow('validator endpoint is not on signet');

    await expect(verifyDeploymentEndpointIdentity('signet', 'signet', 'esplora', 'https://esplora.example',
      jest.fn(async () => new Response('00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043')) as typeof fetch,
    )).rejects.toThrow('esplora endpoint is not on signet');

    await expect(verifyDeploymentEndpointIdentity('signet', 'signet', 'esplora', 'https://esplora.example',
      jest.fn(async () => new Response('00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6')) as typeof fetch,
    )).resolves.toBeUndefined();
  });

  it('requires exact validator deployment identity but maps Esplora identity to Bitcoin genesis', async () => {
    const alphaValidator = jest.fn(async () => Response.json({ chain_network: 'alpha-mainnet' })) as typeof fetch;

    await expect(verifyDeploymentEndpointIdentity(
      'mainnet',
      'mainnet',
      'validator',
      'https://validator.example',
      alphaValidator,
    )).rejects.toThrow('validator endpoint is not on mainnet');

    await expect(verifyDeploymentEndpointIdentity(
      'alpha-mainnet',
      'mainnet',
      'validator',
      'https://validator.example',
      alphaValidator,
    )).resolves.toBeUndefined();

    await expect(verifyDeploymentEndpointIdentity(
      'alpha-mainnet',
      'mainnet',
      'esplora',
      'https://esplora.example',
      jest.fn(async () => new Response('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f')) as typeof fetch,
    )).resolves.toBeUndefined();
  });

  it('keeps mainnet signing closed until its guardian key is distinct', () => {
    const sharedGuardian = DUCAT_GUARDIAN_PUBKEYS.mainnet[0];
    expect(guardianKeyPolicyReady('mainnet')).toBe(false);
    expect(isKnownGuardianPubkey('mainnet', sharedGuardian)).toBe(false);
    expect(guardianKeyPolicyReady('signet')).toBe(true);
    expect(isKnownGuardianPubkey('signet', sharedGuardian)).toBe(true);
  });
});
