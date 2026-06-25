export type DucatSnapErrorCode =
  | 'BATCH_ENTRY_INVALID'
  | 'BROADCAST_FAILED'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_NETWORK'
  | 'INVALID_PARAMS'
  | 'INVALID_RECIPIENT'
  | 'MALFORMED_PSBT'
  | 'METHOD_NOT_FOUND'
  | 'MISSING_WITNESS_UTXO'
  | 'ORIGIN_NOT_AUTHORIZED'
  | 'PSBT_INPUT_VALUE_MISMATCH'
  | 'PSBT_SIGHASH_NOT_ALLOWED'
  | 'PSBT_FEE_INVALID'
  | 'PSBT_FEE_UNAVAILABLE'
  | 'PSBT_DUPLICATE_INPUT'
  | 'BATCH_CONFLICTING_OUTPOINT'
  | 'PSBT_INPUT_ACCOUNT_MISMATCH'
  | 'PSBT_INPUT_INDEX_INVALID'
  | 'PSBT_TOO_LARGE'
  | 'UNMANAGED_ADDRESS'
  | 'UNPROMPTED_MAINNET_FORBIDDEN'
  | 'USER_REJECTED';

export class DucatSnapError extends Error {
  readonly code: DucatSnapErrorCode;

  readonly details?: Record<string, unknown>;

  constructor(code: DucatSnapErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DucatSnapError';
    this.code = code;
    this.details = details;
  }
}

export function ducatError(code: DucatSnapErrorCode, message: string, details?: Record<string, unknown>): DucatSnapError {
  return new DucatSnapError(code, message, details);
}

export function isDucatSnapError(error: unknown): error is DucatSnapError {
  return error instanceof DucatSnapError;
}
