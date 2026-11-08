const POLICY_ENV = [
  'DUCAT_SNAP_ARTIFACT_POLICY',
  'DUCAT_SNAP_DEV_ORIGINS',
  'DUCAT_SNAP_DEV_UNPROMPTED',
  'DUCAT_SNAP_DEBUG',
] as const;

const DEVELOPMENT_ORIGINS = 'http://localhost:3000,http://localhost:8075,http://frontend:3000,http://ducat-admin:8075,https://dev.ducatprotocol.com';

let savedEnvironment: Record<(typeof POLICY_ENV)[number], string | undefined>;

beforeEach(() => {
  savedEnvironment = Object.fromEntries(POLICY_ENV.map((name) => [name, process.env[name]])) as typeof savedEnvironment;
  process.env.DUCAT_SNAP_ARTIFACT_POLICY = 'development';
  process.env.DUCAT_SNAP_DEV_ORIGINS = DEVELOPMENT_ORIGINS;
  process.env.DUCAT_SNAP_DEV_UNPROMPTED = 'false';
  process.env.DUCAT_SNAP_DEBUG = 'false';
  jest.resetModules();
});

afterEach(() => {
  for (const name of POLICY_ENV) {
    const value = savedEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  jest.resetModules();
});

describe('Snap installation disclosure', () => {
  it('shows the welcome screen and default network', async () => {
    const request = jest.fn(async (_args: { method: string; params?: { content?: unknown } }) => undefined);
    (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };
    const { onInstall } = require('../index') as typeof import('../index');

    await onInstall({ origin: 'metamask' });

    const dialog = request.mock.calls.find(([args]) => args.method === 'snap_dialog');
    const content = JSON.stringify(dialog?.[0]?.params?.content ?? '');
    expect(content).toContain('Your Ducat wallet is ready');
    expect(content).toContain('Your keys stay in MetaMask');
    expect(content).toContain('Testnet');
    expect(content).not.toContain('Mainnet enabled');
  });
});
