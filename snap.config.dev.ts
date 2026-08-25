import type { SnapConfig } from '@metamask/snaps-cli';
import { resolve } from 'path';

const devRoot = resolve(__dirname, '.snap/dev');

const config: SnapConfig = {
  input: resolve(__dirname, 'src/index.ts'),
  output: {
    path: resolve(devRoot, 'dist'),
    clean: true,
  },
  manifest: {
    path: resolve(devRoot, 'snap.manifest.json'),
  },
  server: {
    root: devRoot,
    port: 8080,
  },
  polyfills: true,
  environment: {
    DUCAT_SNAP_ARTIFACT_POLICY: 'development',
    DUCAT_SNAP_DEV_UNPROMPTED: 'false',
    DUCAT_SNAP_DEBUG: 'false',
    DUCAT_SNAP_DEV_ORIGINS: process.env.DUCAT_SNAP_DEV_ORIGINS ?? '',
    ALPHA_MAINNET_VALIDATOR_BASE_URL: 'https://validator-mainnet.alpha.ducatprotocol.com',
    ALPHA_MAINNET_ESPLORA_BASE_URL: 'https://mempool.space/api',
  },
};

export default config;
