#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

release_tmp="$(mktemp -d)"
trap 'rm -rf "$release_tmp"' EXIT
cp snap.manifest.json "$release_tmp/manifest.before.json"
git status --short --untracked-files=no >"$release_tmp/status.before"

node --test scripts/release-policy.test.mjs scripts/package-policy.test.mjs
node scripts/release-policy.mjs

export DUCAT_SNAP_DEV_UNPROMPTED=false
export DUCAT_SNAP_DEBUG=false
export DUCAT_SNAP_DEV_ORIGINS=
export DUCAT_SNAP_ARTIFACT_POLICY=production

npm run verify
npm run verify:harness
node scripts/release-policy.mjs --verify-artifacts
npm run audit:prod

export npm_config_cache="$release_tmp/npm-cache"
npm pack --dry-run --json | node scripts/package-policy.mjs

cmp -s snap.manifest.json "$release_tmp/manifest.before.json" || {
  echo "Tracked production manifest changed during release verification." >&2
  exit 1
}
git status --short --untracked-files=no >"$release_tmp/status.after"
cmp -s "$release_tmp/status.before" "$release_tmp/status.after" || {
  echo "Tracked working-tree state changed during release verification." >&2
  diff -u "$release_tmp/status.before" "$release_tmp/status.after" >&2 || true
  exit 1
}

if find . -maxdepth 1 -type f -name '*.tgz' -print -quit | grep -q .; then
  echo "Release verification left a tarball in the repository." >&2
  exit 1
fi

echo "Release verification completed."
