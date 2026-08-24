import type { SnapConfig } from '@metamask/snaps-cli';
import { resolve } from 'path';

const alphaRoot = resolve(__dirname, '.snap/alpha');

const config: SnapConfig = {
  input: resolve(__dirname, 'src/index.ts'),
  output: {
    path: resolve(alphaRoot, 'dist'),
    clean: true,
  },
  manifest: {
    path: resolve(alphaRoot, 'snap.manifest.json'),
  },
  server: {
    root: alphaRoot,
    port: 8080,
  },
  polyfills: true,
  environment: {
    DUCAT_SNAP_ARTIFACT_POLICY: 'alpha-mainnet',
    DUCAT_SNAP_DEV_UNPROMPTED: 'false',
    DUCAT_SNAP_DEBUG: 'false',
    DUCAT_SNAP_DEV_ORIGINS: '',
    DUCAT_SNAP_ALPHA_ORIGIN: 'http://localhost:8075',
    ALPHA_MAINNET_VALIDATOR_BASE_URL: process.env.ALPHA_MAINNET_VALIDATOR_BASE_URL ?? '',
    ALPHA_MAINNET_ESPLORA_BASE_URL: process.env.ALPHA_MAINNET_ESPLORA_BASE_URL ?? '',
  },
  customizeWebpackConfig: (webpackConfig) => {
    const aliases = webpackConfig.resolve?.alias;
    if (Array.isArray(aliases)) {
      throw new Error('alpha Snap build requires object-form Webpack aliases');
    }
    return {
      ...webpackConfig,
      resolve: {
        ...webpackConfig.resolve,
        alias: {
          ...aliases,
          './artifact-policy$': resolve(__dirname, 'src/artifact-policy.alpha.ts'),
          './network-profiles$': resolve(__dirname, 'src/network-profiles.alpha.ts'),
        },
      },
    };
  },
};

export default config;
