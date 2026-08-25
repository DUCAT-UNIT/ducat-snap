/** @fileoverview Verifies every PSBT prevout against Snap-owned wallet data, earlier batch entries, or trusted Esplora reads. */
import { Transaction, type Psbt } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { ducatError } from './errors';
import { getEffectiveNetworkProfile, type DeploymentProfile } from './network-profiles';
import type { DeploymentId, PsbtSummary, WalletInventoryResponse } from './types';
import { getWalletInventory } from './wallet-inventory';

const FETCH_TIMEOUT_MS = 12_000;
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/iu;
const TXID_PATTERN = /^[0-9a-f]{64}$/iu;

type VerifiedPrevout = {
  txid: string;
  vout: number;
  valueSats: number;
  scriptPubKey: string;
};

type VerificationDependencies = {
  fetchImpl?: typeof fetch;
  inventory?: WalletInventoryResponse;
  profile?: DeploymentProfile;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalTxid(hash: Uint8Array): string {
  return Buffer.from(hash).reverse().toString('hex');
}

function mismatch(message: string, details?: Record<string, unknown>): never {
  throw ducatError('WALLET_DATA_MISMATCH', message, details);
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw ducatError('WALLET_DATA_UNAVAILABLE', 'Wallet verification data is temporarily unavailable.');
  }
  if (!response.ok) {
    throw ducatError('WALLET_DATA_UNAVAILABLE', 'Wallet verification data is temporarily unavailable.', { status: response.status });
  }
  try {
    return await response.json();
  } catch {
    mismatch('Wallet verification data was malformed.');
  }
}

function decodePrevout(txid: string, vout: number, tx: unknown): VerifiedPrevout {
  if (!isRecord(tx) || tx.txid !== txid || !Array.isArray(tx.vout)) mismatch('Wallet verification data was malformed.');
  const output = tx.vout[vout];
  if (!isRecord(output)) mismatch('The PSBT references a previous output that does not exist.', { txid, vout });
  const value = output.value;
  const script = typeof output.scriptpubkey === 'string' ? output.scriptpubkey.toLowerCase() : '';
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || !HEX_PATTERN.test(script)) {
    mismatch('Wallet verification data was malformed.', { txid, vout });
  }
  return { txid, vout, valueSats: Number(value), scriptPubKey: script };
}

function assertUnspent(value: unknown, txid: string, vout: number): void {
  if (!isRecord(value) || typeof value.spent !== 'boolean') mismatch('Wallet spend-status data was malformed.', { txid, vout });
  if (value.spent) mismatch('The PSBT references a previous output that is already spent.', { txid, vout });
}

export class PsbtVerificationContext {
  readonly #inventory: WalletInventoryResponse;
  readonly #profile: DeploymentProfile;
  readonly #fetch: typeof fetch;
  readonly #prevouts = new Map<string, Promise<VerifiedPrevout>>();
  readonly #batchPrevouts = new Map<string, VerifiedPrevout>();

  constructor(network: DeploymentId, dependencies: Required<VerificationDependencies>) {
    this.#inventory = dependencies.inventory;
    this.#profile = dependencies.profile;
    this.#fetch = dependencies.fetchImpl;
    if (this.#inventory.network !== network || this.#profile.id !== network) {
      mismatch('Wallet verification data did not match the selected network.');
    }
  }

  async #externalPrevout(txid: string, vout: number): Promise<VerifiedPrevout> {
    const key = `${txid}:${vout}`;
    const existing = this.#prevouts.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const [tx, spend] = await Promise.all([
        fetchJson(this.#fetch, `${this.#profile.esplora_base_url}/tx/${txid}`),
        fetchJson(this.#fetch, `${this.#profile.esplora_base_url}/tx/${txid}/outspend/${vout}`),
      ]);
      assertUnspent(spend, txid, vout);
      return decodePrevout(txid, vout, tx);
    })();
    this.#prevouts.set(key, pending);
    return pending;
  }

  #rememberVerifiedOutputs(psbt: Psbt): void {
    // Some focused verification tests intentionally use the smallest possible
    // Psbt-shaped double. Only real bitcoinjs PSBTs can contribute outputs to a
    // later batch entry.
    const unsignedTx = psbt.data.globalMap?.unsignedTx;
    if (!unsignedTx) return;
    let txid: string;
    try {
      txid = Transaction.fromBuffer(unsignedTx.toBuffer()).getId();
    } catch {
      mismatch('A verified batch transaction could not be decoded.');
    }
    for (const [vout, output] of psbt.txOutputs.entries()) {
      const scriptPubKey = Buffer.from(output.script).toString('hex');
      if (!Number.isSafeInteger(output.value) || output.value < 0 || !HEX_PATTERN.test(scriptPubKey)) {
        mismatch('A verified batch transaction contained a malformed output.', { txid, vout });
      }
      this.#batchPrevouts.set(`${txid}:${vout}`, {
        txid,
        vout,
        valueSats: output.value,
        scriptPubKey,
      });
    }
  }

  async verify(psbt: Psbt, summary: PsbtSummary): Promise<void> {
    const btc = new Map(this.#inventory.btcUtxos.map((row) => [`${row.txid}:${row.vout}`, row]));
    const unit = new Map(this.#inventory.unitUtxos.map((row) => [`${row.txid}:${row.vout}`, row]));
    const unitEvidence: PsbtSummary['unitInputs'] = [];

    await Promise.all(psbt.txInputs.map(async (input, index) => {
      const txid = canonicalTxid(input.hash);
      if (!TXID_PATTERN.test(txid) || !Number.isSafeInteger(input.index) || input.index < 0) {
        mismatch('The PSBT contains a malformed previous-output reference.', { inputIndex: index });
      }
      const witness = psbt.data.inputs[index]?.witnessUtxo;
      if (!witness) {
        throw ducatError('MISSING_WITNESS_UTXO', 'Every PSBT input must include previous-output value data for verification.', { inputIndex: index });
      }
      const key = `${txid}:${input.index}`;
      const walletBtc = btc.get(key);
      const walletUnit = unit.get(key);
      const verified = walletBtc
        ?? walletUnit
        ?? this.#batchPrevouts.get(key)
        ?? await this.#externalPrevout(txid, input.index);
      const actualScript = Buffer.from(witness.script).toString('hex');
      const expectedScript = 'scriptPubKey' in verified ? verified.scriptPubKey : '';
      const expectedValue = 'valueSats' in verified ? verified.valueSats : verified.coinValueSats;
      if (witness.value !== expectedValue || actualScript !== expectedScript) {
        mismatch('A PSBT input did not match its verified previous output.', { inputIndex: index, txid, vout: input.index });
      }
      if (walletUnit) {
        unitEvidence.push({
          outpoint: key,
          coinId: walletUnit.coinId,
          assetId: walletUnit.assetId,
          activeAmount: walletUnit.activeAmount,
          reservedAmount: walletUnit.reservedAmount,
          classification: walletUnit.classification,
        });
      }
    }));

    summary.unitInputs = unitEvidence.sort((left, right) => left.outpoint.localeCompare(right.outpoint));
    // Batch entries are verified in request order. Only after every input of an
    // entry is trusted may its unsigned outputs become trusted prevouts for a
    // later entry in the same atomic batch.
    this.#rememberVerifiedOutputs(psbt);
  }
}

export async function createPsbtVerificationContext(
  network: DeploymentId,
  dependencies: VerificationDependencies = {},
): Promise<PsbtVerificationContext> {
  const [inventory, profile] = await Promise.all([
    dependencies.inventory
      ? Promise.resolve(dependencies.inventory)
      : getWalletInventory(network, { fresh: true }),
    dependencies.profile ? Promise.resolve(dependencies.profile) : getEffectiveNetworkProfile(network),
  ]);
  return new PsbtVerificationContext(network, {
    fetchImpl: dependencies.fetchImpl ?? fetch,
    inventory,
    profile,
  });
}

export { canonicalTxid };
