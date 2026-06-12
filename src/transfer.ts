import { address as btcAddress, Psbt } from 'bitcoinjs-lib';

import { getAccountKeySet } from './accounts';
import { confirmTransfer } from './confirmations';
import { bitcoinNetwork, esploraUrl, normalizeNetwork } from './networks';
import { appendRecentAction } from './state';

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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function postText(url: string, body: string): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Broadcast failed: ${response.status} ${response.statusText}`);
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

function selectUtxos(utxos: EsploraUtxo[], amountSats: number, feeRate: number): {
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
      feeSats = estimateFee(selected.length, 1, feeRate);
      changeSats = selectedValue - amountSats - feeSats;
    }

    if (changeSats >= 0) {
      return { selected, feeSats, changeSats };
    }
  }

  throw new Error('Insufficient funds for transfer and fee.');
}

export async function sendTransfer(origin: string, params: SendTransferParams): Promise<{ txid: string }> {
  const network = normalizeNetwork(params.network);
  const recipient = typeof params.address === 'string' ? params.address : '';
  const amountSats = typeof params.amountSats === 'number' ? Math.floor(params.amountSats) : 0;

  if (amountSats <= 0) {
    throw new Error('Transfer amount must be greater than zero.');
  }

  try {
    btcAddress.toOutputScript(recipient, bitcoinNetwork(network));
  } catch {
    throw new Error(`Invalid recipient address for ${network}.`);
  }

  const keySet = await getAccountKeySet(network);
  const endpoint = esploraUrl(network);
  const feeRate = await getFeeRate(endpoint, params.feeRate);
  const utxos = await fetchJson<EsploraUtxo[]>(`${endpoint}/address/${keySet.record.sats.address}/utxo`);
  const { selected, feeSats, changeSats } = selectUtxos(utxos, amountSats, feeRate);
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

  await confirmTransfer({
    origin,
    network,
    from: keySet.record.sats.address,
    to: recipient,
    amountSats,
    feeSats,
    feeRate,
  });

  selected.forEach((_, index) => psbt.signInput(index, keySet.satsNode));
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();
  const txid = await postText(`${endpoint}/tx`, txHex);

  await appendRecentAction({
    actionType: 'transfer',
    network,
    origin,
    txid,
    summary: `${amountSats} sats to ${recipient}`,
  });

  return { txid };
}
