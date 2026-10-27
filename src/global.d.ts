/** @fileoverview Declares the MetaMask Snap global and narrow core-library API surface consumed by this package. */
declare const snap: {
  request: <Result = unknown>(args: { method: string; params?: unknown }) => Promise<Result>;
};

declare module '@ducat-unit/core/lib' {
  export interface RecoveryMessage {
    target_coin_id: string; contract_id: string; client_pubkey: string; output_index: number; vault_return_script: string;
  }
  export function decode_vault_recovery_message(script: string): RecoveryMessage;
  export function decode_vault_return_script(proto: unknown, script: string): { unit_balance: number };
  export function verify_proto_profile(proto: unknown): void;
  export function create_recovery_profile(proto: unknown, message: RecoveryMessage,
    output: {txid: string; vout: number; value: number; script_pk: string}, ledger: {root_txid: string; accepted_unit_debt: number}): {guard_members: string[]};
  export function extract_vault_price_contracts(proto: unknown, returned: unknown): unknown[];
  export function is_oracle_event_fresh(contract: unknown, age: number, stamp: number): boolean;
  export function create_asset_transfer_script(config: { asset_id: string; amount: bigint; output: number }[]): { hex: string };
  export function get_vault_terms(termEntries: unknown[]): { unit_asset_id: string };
}

// snaps-cli bundles `.svg` imports as their UTF-8 source (`asset/source`); jest mirrors this via
// scripts/jest-svg-transform.cjs.
declare module '*.svg' {
  const content: string;
  export default content;
}
