import type { SnapConfig } from '@metamask/snaps-cli';
import { resolve } from 'path';

const config: SnapConfig = {
  input: resolve(__dirname, 'src/index.ts'),
  server: {
    port: 8080,
  },
  polyfills: true,
  // Build-time env injection. mm-snap/webpack inlines these as string literals so guarded
  // branches dead-code-eliminate. DUCAT_SNAP_DEV_UNPROMPTED gates the dev-only unprompted
  // signing path: it is intentionally pinned to 'false' here so the DEFAULT/published build
  // never ships that path. A dev build enables it explicitly, e.g.:
  //   DUCAT_SNAP_DEV_UNPROMPTED=true mm-snap build
  // (env values from the shell override this default). It must NEVER be 'true' in the
  // published/audited mainnet manifest.
  environment: {
    DUCAT_SNAP_DEV_UNPROMPTED: process.env.DUCAT_SNAP_DEV_UNPROMPTED ?? 'false',
  },
};

export default config;
