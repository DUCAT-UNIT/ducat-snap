import { address as btcAddress, Psbt } from 'bitcoinjs-lib';

import { getAccountKeySet } from './accounts';
import { confirmTransfer } from './confirmations';
import { ducatError } from './errors';
import { bitcoinNetwork, esploraUrl, normalizeNetwork } from './networks';
import { notifyAction, notifyActionFailure } from './notifications';
import { appendRecentAction, rememberDucatSession } from './state';

type EsploraUtxo = {
  txid: string;
  vout: number;
  value: number;
};

type SendTransferParams = {
  network?: unknown;
  address?: unknown;
  amountSats?: unknown;
  feeRate?: unknown;
};

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response;

  try {
    response = await fetchWithTimeout(url);
  } catch (error) {
    throw ducatError('INVALID_PARAMS', 'Unable to fetch Bitcoin network data for this transfer.', {
      url,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (!response.ok) {
    throw ducatError('INVALID_PARAMS', 'Unable to fetch Bitcoin network data for this transfer.', {
      status: response.status,
      statusText: response.statusText,
      url,
    });
  }

  return response.json() as Promise<T>;
}

async function postText(url: string, body: string): Promise<string> {
  let response: Response;

  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
    });
  } catch (error) {
    throw ducatError('BROADCAST_FAILED', 'The transaction was signed, but broadcasting it to the Bitcoin network failed.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const text = await response.text();

  if (!response.ok) {
    throw ducatError('BROADCAST_FAILED', 'The transaction was signed, but broadcasting it to the Bitcoin network failed.', {
      status: response.status,
      statusText: response.statusText,
      response: text,
    });
  }

  return text;
}

function estimateFee(inputCount: number, outputCount: number, feeRate: number): number {
  return Math.ceil((10 + inputCount * 68 + outputCount * 31) * feeRate);
}

async function getFeeRate(endpoint: string, feeRate?: unknown): Promise<number> {
  if (typeof feeRate === 'number' && Number.isFinite(feeRate) && feeRate > 0) {
    return Math.ceil(feeRate);
  }

  try {
    const estimates = await fetchJson<Record<string, number>>(`${endpoint}/fee-estimates`);

    return Math.max(1, Math.ceil(estimates['2'] ?? estimates['3'] ?? estimates['6'] ?? 1));
  } catch {
    return 1;
  }
}

export function selectUtxos(utxos: EsploraUtxo[], amountSats: number, feeRate: number): {
  selected: EsploraUtxo[];
  feeSats: number;
  changeSats: number;
} {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const selected: EsploraUtxo[] = [];
  let selectedValue = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    selectedValue += utxo.value;

    let feeSats = estimateFee(selected.length, 2, feeRate);
    let changeSats = selectedValue - amountSats - feeSats;

    if (changeSats > 0 && changeSats < 546) {
      changeSats = 0;
      feeSats = selectedValue - amountSats;
    }

    if (changeSats >= 0) {
      return { selected, feeSats, changeSats };
    }
  }

  throw ducatError('INSUFFICIENT_FUNDS', 'The Ducat Snap BTC account does not have enough funds for this transfer and fee.', {
    requestedAmountSats: amountSats,
    availableSats: utxos.reduce((total, utxo) => total + utxo.value, 0),
  });
}

export async function sendTransfer(origin: string, params: SendTransferParams): Promise<{ txid: string }> {
  const network = normalizeNetwork(params.network);
  const recipient = typeof params.address === 'string' ? params.address : '';
  const amountSats = typeof params.amountSats === 'number' ? Math.floor(params.amountSats) : 0;

  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw ducatError('INVALID_PARAMS', 'Transfer amount must be greater than zero.');
  }

  try {
    btcAddress.toOutputScript(recipient, bitcoinNetwork(network));
  } catch {
    throw ducatError('INVALID_RECIPIENT', 'The recipient address is not valid for this Ducat testnet network.', {
      network,
      recipient,
    });
  }

  const keySet = await getAccountKeySet(network);
  const endpoint = esploraUrl(network);
  const feeRate = await getFeeRate(endpoint, params.feeRate);
  const utxos = await fetchJson<EsploraUtxo[]>(`${endpoint}/address/${keySet.record.sats.address}/utxo`);
  const { selected, feeSats, changeSats } = selectUtxos(utxos, amountSats, feeRate);
  const inputValueSats = selected.reduce((total, utxo) => total + utxo.value, 0);
  const psbt = new Psbt({ network: bitcoinNetwork(network) });

  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: keySet.satsOutputScript,
        value: utxo.value,
      },
    });
  }

  psbt.addOutput({ address: recipient, value: amountSats });

  if (changeSats >= 546) {
    psbt.addOutput({ address: keySet.record.sats.address, value: changeSats });
  }

  await rememberDucatSession(network, origin);
  await notifyAction({ title: 'Send BTC', status: 'pending', detail: 'Transfer approval requested' });

  try {
    await confirmTransfer({
      origin,
      network,
      from: keySet.record.sats.address,
      to: recipient,
      amountSats,
      feeSats,
      feeRate,
      changeSats,
      inputCount: selected.length,
      inputValueSats,
      broadcastEndpoint: endpoint,
    });
  } catch (error) {
    await notifyActionFailure('Send BTC', error);
    throw error;
  }

  selected.forEach((_, index) => psbt.signInput(index, keySet.satsNode));
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();
  let txid: string;

  try {
    txid = await postText(`${endpoint}/tx`, txHex);
  } catch (error) {
    await appendRecentAction({
      actionType: 'transfer',
      title: 'Send BTC',
      network,
      origin,
      status: 'failed',
      amountSats,
      summary: `Broadcast failed for ${amountSats} sats to ${recipient}`,
    });
    await notifyActionFailure('Send BTC', error);

    throw error;
  }

  await appendRecentAction({
    actionType: 'transfer',
    title: 'Send BTC',
    network,
    origin,
    status: 'broadcast',
    txid,
    amountSats,
    summary: `${amountSats} sats to ${recipient}`,
  });
  await notifyAction({ title: 'Send BTC', status: 'completed', detail: 'Broadcast to Bitcoin testnet' });

  return { txid };
}
