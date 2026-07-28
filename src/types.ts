/** @fileoverview Defines shared network, account, signing, PSBT, action, endpoint, and state contracts. */
export type DucatNetwork = 'mainnet' | 'signet' | 'mutinynet' | 'testnet4' | 'regtest';

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

export type WalletBtcUtxo = {
  txid: string;
  vout: number;
  valueSats: number;
  scriptPubKey: string;
};

export type WalletUnitUtxo = {
  txid: string;
  vout: number;
  coinId: string;
  coinValueSats: number;
  scriptPubKey: string;
  assetId: string;
  activeAmount: string;
  reservedAmount: string;
  classification: 'active' | 'reserved' | 'mixed';
};

export type WalletInventoryResponse = {
  network: DucatNetwork;
  observedAt: number;
  expiresAt: number;
  assetId: string;
  account: WalletAccountRecord;
  balances: {
    btcSats: string;
    btcUtxos: number;
    unitActive: string;
    unitReserved: string;
    unitMixedActive: string;
    unitMixedReserved: string;
  };
  btcUtxos: WalletBtcUtxo[];
  unitUtxos: WalletUnitUtxo[];
};

export type DucatAccountSource = 'derived' | 'imported';

export type DerivedDucatAccountRecord = WalletAccountRecord & {
  id: string;
  source: 'derived';
  network: DucatNetwork;
};

export type PrivateKeyOverrideRecord = {
  id: string;
  source: 'imported';
  network: DucatNetwork;
  created_at: number;
  fingerprint: string;
  private_key: string;
  sats: DucatAccount;
  runes: DucatAccount;
};

export type PublicDucatAccountRecord = DerivedDucatAccountRecord | Omit<PrivateKeyOverrideRecord, 'private_key'>;

export type NetworkEndpointOverride = {
  validator_base_url?: string;
  esplora_base_url?: string;
  network_identity_verified?: true;
};

export type NetworkEndpointOverrides = Partial<Record<DucatNetwork, NetworkEndpointOverride>>;

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

export type DucatVaultActionFlag = 'o' | 'b' | 'r' | 'd' | 'w' | 'x' | 'l' | 'c';

export type DucatVaultReturnData = {
  actionFlag: DucatVaultActionFlag;
  actionType: string;
  protocolAction?: string;
  sequenceCode?: number;
  sequenceVersion?: number;
  outputIndex: number;
  isLocked: boolean;
  unitBalanceCents: number;
  unitBalanceUnit: number;
  unitPrice: number;
  unitTimestamp: number;
  collateralSats?: number;
  tholdPrice?: number;
  tholdHash?: string;
  guardianCount?: number;
  priceCommitCount?: number;
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
  | 'committed-ducat-cosign-leaf'
  | 'committed-bitvm3-timeout-leaf';

export type PsbtInputSummary = {
  index: number;
  address: string;
  signingAddress: string;
  role: DucatAddressRole;
  valueSats: number | null;
  verification: PsbtInputVerification;
  /** For committed cosign-leaf inputs: the guard (cosigner) x-only pubkey, lowercase hex. */
  cosignGuardPubkey?: string;
  /** Whether the guard key is in the configured Ducat guardian allowlist (undefined when no allowlist is configured). */
  cosignGuardianKnown?: boolean;
  unit?: {
    outpoint: string;
    coinId: string;
    assetId: string;
    activeAmount: string;
    reservedAmount: string;
    classification: 'active' | 'reserved' | 'mixed';
  };
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
  unitInputs: NonNullable<PsbtInputSummary['unit']>[];
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
  selectedNetwork: DucatNetwork;
  lastOrigin?: string;
  keyOverrides?: PrivateKeyOverrideRecord[];
  networkEndpointOverrides?: NetworkEndpointOverrides;
};
