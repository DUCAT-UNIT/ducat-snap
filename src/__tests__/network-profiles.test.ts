import {
  effectiveNetworkProfile,
  networkProfile,
  validateNetworkProfiles,
} from '../network-profiles';
import { verifyNetworkEndpointIdentity } from '../network-endpoint-policy';
import { DUCAT_GUARDIAN_PUBKEYS, guardianKeyPolicyReady, isKnownGuardianPubkey } from '../networks';

describe('network profiles', () => {
  it('loads one bundled profile per supported network', () => {
    const profiles = validateNetworkProfiles({
      networks: [
        {
          id: 'signet',
          label: 'Signet',
          validator_base_url: 'https://validator-testnet4.dev.ducatprotocol.com',
          esplora_base_url: 'https://mempool.space/signet/api',
        },
      ],
    });

    expect(profiles).toEqual([
      expect.objectContaining({
        id: 'signet',
        validator_base_url: 'https://validator-testnet4.dev.ducatprotocol.com',
        esplora_base_url: 'https://mempool.space/signet/api',
      }),
    ]);
  });

  it('rejects duplicate network ids', () => {
    expect(() => validateNetworkProfiles({
      networks: [
        { id: 'signet', label: 'A', validator_base_url: 'https://validator-a.example', esplora_base_url: 'https://esplora-a.example' },
        { id: 'signet', label: 'B', validator_base_url: 'https://validator-b.example', esplora_base_url: 'https://esplora-b.example' },
      ],
    })).toThrow('duplicate network profile: signet');
  });

  it('rejects malformed profile containers and entries', () => {
    expect(() => validateNetworkProfiles(null)).toThrow('network profiles must include a networks array');
    expect(() => validateNetworkProfiles({ networks: [null] })).toThrow('network profile entries must be objects');
    expect(() => validateNetworkProfiles({ networks: ['signet'] })).toThrow('network profile entries must be objects');
  });

  it('rejects non-http endpoint URLs', () => {
    expect(() => validateNetworkProfiles({
      networks: [
        { id: 'signet', label: 'Signet', validator_base_url: 'file:///tmp/validator', esplora_base_url: 'https://mempool.space/signet/api' },
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
    await expect(verifyNetworkEndpointIdentity('signet', 'validator', 'https://validator.example',
      jest.fn(async () => Response.json([])) as typeof fetch,
    )).rejects.toThrow('validator endpoint is not on signet');

    await expect(verifyNetworkEndpointIdentity('signet', 'validator', 'https://validator.example',
      jest.fn(async () => Response.json({ chain_network: 'testnet4' })) as typeof fetch,
    )).rejects.toThrow('validator endpoint is not on signet');

    await expect(verifyNetworkEndpointIdentity('signet', 'esplora', 'https://esplora.example',
      jest.fn(async () => new Response('00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043')) as typeof fetch,
    )).rejects.toThrow('esplora endpoint is not on signet');

    await expect(verifyNetworkEndpointIdentity('signet', 'esplora', 'https://esplora.example',
      jest.fn(async () => new Response('00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6')) as typeof fetch,
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
