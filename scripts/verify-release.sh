#!/usr/bin/env bash
set -euo pipefail

rm -f ducat-unit-ducat-snap-*.tgz

npm run verify
npm run audit:prod
npm run snapper
npm run verify:metadata
npm run verify:release-manifest
npm run pack:dry-run

echo "Release verification completed."
