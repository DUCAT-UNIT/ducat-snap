#!/usr/bin/env bash
set -euo pipefail

node --test scripts/release-policy.test.mjs
node scripts/release-policy.mjs

export DUCAT_SNAP_DEV_UNPROMPTED=false
export DUCAT_SNAP_DEBUG=false
export DUCAT_SNAP_DEV_ORIGINS=

rm -f ducat-unit-wallet-snap-*.tgz

npm run verify
npm run verify:harness
npm run audit:prod
npm run pack:dry-run

echo "Release verification completed."
