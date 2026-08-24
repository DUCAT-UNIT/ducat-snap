#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

export const EXPECTED_PACKAGE_PATHS = Object.freeze([
  'LICENSE',
  'README.md',
  'dist/bundle.js',
  'images/icon.svg',
  'package.json',
  'snap.manifest.json',
]);

function normalizedPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\\')
    || value.includes('\0')
    || posix.isAbsolute(value)
    || value.startsWith('../')
    || posix.normalize(value) !== value
  ) {
    throw new Error(`invalid package path: ${String(value)}`);
  }
  return value;
}

export function assertPackagePaths(paths) {
  if (!Array.isArray(paths)) {
    throw new Error('package paths must be an array');
  }
  const normalized = paths.map(normalizedPath);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('duplicate package path');
  }
  const actual = [...normalized].sort();
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_PACKAGE_PATHS)) {
    throw new Error(`package path policy mismatch: ${JSON.stringify(actual)}`);
  }
  return actual;
}

export function decodePackJson(input) {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('stdin must contain valid npm pack JSON with no trailing input');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('expected exactly one npm pack result');
  }
  if (!parsed[0] || !Array.isArray(parsed[0].files)) {
    throw new Error('npm pack result must contain a files array');
  }
  return assertPackagePaths(parsed[0].files.map((file) => file?.path));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const paths = decodePackJson(readFileSync(0, 'utf8'));
    console.log(`package-policy: verified ${paths.length} reviewed files`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
