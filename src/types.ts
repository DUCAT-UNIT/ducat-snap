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
};

export type PsbtOutputSummary = {
  address: string;
  valueSats: number;
  isMine: boolean;
};

export type PsbtSummary = {
  network: DucatNetwork;
  inputCount: number;
  signedInputIndexes: number[];
  outputCount: number;
  outputs: PsbtOutputSummary[];
  feeSats: number | null;
  inputValueSats: number | null;
  outputValueSats: number;
};

export type RecentAction = {
  id: string;
  actionType: string;
  network: DucatNetwork;
  origin: string;
  timestamp: number;
  txid?: string;
  summary?: string;
};

export type DucatSnapState = {
  recentActions: RecentAction[];
};
