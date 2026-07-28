const BOOLEAN_RELEASE_FLAGS = ['DUCAT_SNAP_DEV_UNPROMPTED', 'DUCAT_SNAP_DEBUG'];

export function assertReleaseEnvironment(env = process.env) {
  for (const name of BOOLEAN_RELEASE_FLAGS) {
    const value = env[name]?.trim().toLowerCase();
    if (value !== undefined && value !== '' && value !== 'false') {
      throw new Error(`${name} must be unset, empty, or false for a release build.`);
    }
  }

  if ((env.DUCAT_SNAP_DEV_ORIGINS ?? '').trim() !== '') {
    throw new Error('DUCAT_SNAP_DEV_ORIGINS must be unset or empty for a release build.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    assertReleaseEnvironment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

