import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertReleaseEnvironment } from './release-policy.mjs';

test('accepts a clean release environment', () => {
  assert.doesNotThrow(() => assertReleaseEnvironment({}));
  assert.doesNotThrow(() => assertReleaseEnvironment({
    DUCAT_SNAP_DEV_UNPROMPTED: 'false',
    DUCAT_SNAP_DEBUG: '',
    DUCAT_SNAP_DEV_ORIGINS: '  ',
  }));
});

for (const name of ['DUCAT_SNAP_DEV_UNPROMPTED', 'DUCAT_SNAP_DEBUG']) {
  test(`rejects ${name} when enabled`, () => {
    assert.throws(
      () => assertReleaseEnvironment({ [name]: 'true' }),
      new RegExp(`${name} must be unset, empty, or false`),
    );
  });
}

test('rejects development origins', () => {
  assert.throws(
    () => assertReleaseEnvironment({ DUCAT_SNAP_DEV_ORIGINS: 'http://localhost:3000' }),
    /DUCAT_SNAP_DEV_ORIGINS must be unset or empty/,
  );
});

