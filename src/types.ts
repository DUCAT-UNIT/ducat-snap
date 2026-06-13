export type DucatNetwork = 'signet' | 'mutinynet';

export type DucatAddressRole = 'sats' | 'runes' | 'vault';

export type DucatAccount = {
  address: string;
  pubkey: string;
};

export type WalletAuthCandidate = {
  address: string;
  publicKey: string;
  addressType?: string;
  isPreferred?: boolean;
};

export type WalletAccountRecord = {
  sats: DucatAccount;
  runes: DucatAccount;
  vault: DucatAccount;
  authCandidates: WalletAuthCandidate[];
};

export type SignInputs = Record<string, number[]>;

export type DucatActionContext = {
  actionType?: string;
  title?: string;
  flow?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  vault?: {
    effect?: string;
    source?: string;
    amountSats?: number;
    amountUnit?: number;
    collateralBeforeSats?: number;
    collateralAfterSats?: number;
    debtBeforeUnit?: number;
    debtAfterUnit?: number;
    healthBefore?: number | null;
    healthAfter?: number | null;
    liquidationPrice?: number;
    price?: number;
  };
};

export type DucatVaultActionFlag = 'o' | 'b' | 'r' | 'd' | 'w' | 'x' | 'l';

export type DucatVaultReturnData = {
  actionFlag: DucatVaultActionFlag;
  actionType: string;
  outputIndex: number;
  isLocked: boolean;
  unitBalanceCents: number;
  unitBalanceUnit: number;
  unitPrice: number;
  unitTimestamp: number;
  collateralSats?: number;
  tholdPrice?: number;
  tholdHash?: string;
};

export type PsbtOutputSummary = {
  address: string;
  valueSats: number;
  isMine: boolean;
  role: DucatAddressRole | 'external' | 'op_return' | 'unknown';
  vaultData?: DucatVaultReturnData;
};

export type PsbtInputVerification =
  | 'matched-account-output'
  | 'committed-taproot-script-path';

export type PsbtInputSummary = {
  index: number;
  address: string;
  signingAddress: string;
  role: DucatAddressRole;
  valueSats: number | null;
  verification: PsbtInputVerification;
};

export type PsbtSummary = {
  network: DucatNetwork;
  inputCount: number;
  signedInputIndexes: number[];
  signedInputs: PsbtInputSummary[];
  outputCount: number;
  outputs: PsbtOutputSummary[];
  feeSats: number | null;
  inputValueSats: number | null;
  signedInputValueSats: number | null;
  outputValueSats: number;
  externalOutputSats: number;
  selfOutputSats: number;
  vaultUpdates: DucatVaultReturnData[];
  warnings: string[];
};

export type RecentActionStatus = 'signed' | 'broadcast' | 'failed';

export type RecentAction = {
  id: string;
  actionType: string;
  title?: string;
  network: DucatNetwork;
  origin: string;
  timestamp: number;
  status?: RecentActionStatus;
  txid?: string;
  summary?: string;
  amountSats?: number;
  unitAmount?: number;
  details?: Record<string, string | number | boolean | null>;
};

export type DucatSnapState = {
  recentActions: RecentAction[];
  lastNetwork?: DucatNetwork;
  lastOrigin?: string;
};
