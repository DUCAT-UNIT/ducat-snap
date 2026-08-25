/** @fileoverview Declares the MetaMask Snap global and narrow core-library API surface consumed by this package. */
declare const snap: {
  request: <Result = unknown>(args: { method: string; params?: unknown }) => Promise<Result>;
};

declare module '@ducat-unit/core/lib' {
  export function create_asset_transfer_script(config: { asset_id: string; amount: bigint; output: number }[]): { hex: string };
  export function get_vault_terms(termEntries: unknown[]): { unit_asset_id: string };
}

// snaps-cli bundles `.svg` imports as their UTF-8 source (`asset/source`); jest mirrors this via
// scripts/jest-svg-transform.cjs.
declare module '*.svg' {
  const content: string;
  export default content;
}
