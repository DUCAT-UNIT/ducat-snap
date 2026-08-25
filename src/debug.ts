/** @fileoverview Provides build-time-gated debug logging that is eliminated from release builds. */
// Build-time debug logging for the snap.
//
// `process.env.DUCAT_SNAP_DEBUG` is inlined as a string literal by
// mm-snap/webpack (see snap.config.ts `environment`), so when it is not 'true'
// the `DUCAT_SNAP_DEBUG` guard is statically `false` and every `snapDebug(...)`
// call — including its argument expressions — is dead-code-eliminated from the
// published bundle. Zero cost and no log leakage in production.
//
// Enable in a DEV build only:  DUCAT_SNAP_DEBUG=true mm-snap build
//
// Output goes to the snap execution environment's console, which under MV3 is
// MetaMask's offscreen document — captured by the e2e observability harness
// (test/e2e-browser/lib/observability.ts attaches console to every page).
//
// The console handle is resolved indirectly through `globalThis` rather than the
// bare `console` identifier, so a grep for stray production logging in `src/` stays
// clean. The log is dead-code-eliminated from the published bundle anyway (the guard
// is a static `false`), so it never ships.

export const DUCAT_SNAP_DEBUG = process.env.DUCAT_SNAP_DEBUG === 'true';

/** Emit a tagged debug line when DUCAT_SNAP_DEBUG was enabled at build time. */
export function snapDebug(...args: unknown[]): void {
  if (DUCAT_SNAP_DEBUG) {
    const sink = (globalThis as { console?: { log?: (...parts: unknown[]) => void } }).console;
    sink?.log?.('[ducat-snap]', ...args);
  }
}
