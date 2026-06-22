#!/usr/bin/env bash
set -euo pipefail

rm -f ducat-unit-wallet-snap-*.tgz

npm run verify
npm run verify:harness
npm run audit:prod
npm run pack:dry-run

echo "Release verification completed."
