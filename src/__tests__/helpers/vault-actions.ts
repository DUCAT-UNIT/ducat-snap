/** Actual SDK-generated PSBTs, verified against a deterministic public test ledger. */
import { Buffer } from 'buffer';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import sample from '../fixtures/vault-actions.json';
import { preparePsbtForSigning } from '../../psbt';
import { PsbtVerificationContext } from '../../psbt-verification';
import { vaultDisplayProtocol } from '../../vault-evidence';
import type { SignInputs, WalletInventoryResponse } from '../../types';
import { depositPreview } from './deposit-preview';

export type SampleVaultAction = keyof typeof sample.fixtures;
export async function verifiedVaultAction(action: SampleVaultAction) {
  const { keys } = depositPreview();
  const fixture = sample.fixtures[action];
  const inventory: WalletInventoryResponse = {
    network: 'mutinynet', account: keys.record, assetId: '134:1', observedAt: 1, expiresAt: 30001,
    vaultProtocol: vaultDisplayProtocol(sample.proto, '134:1'),
    btcUtxos: fixture.funding.map((utxo) => ({txid:utxo.txid,vout:utxo.vout,valueSats:utxo.value,scriptPubKey:utxo.script_pk})),
    unitUtxos: fixture.assets.map((asset) => ({txid:asset.coin_id.split(':')[0],vout:0,coinId:asset.coin_id,
      coinValueSats:asset.coin_value,scriptPubKey:asset.coin_script,assetId:asset.asset_id,
      activeAmount:String(asset.asset_balance),reservedAmount:String(asset.asset_reserve),classification:'active'})),
    balances:{btcSats:'0',btcUtxos:0,unitActive:'0',unitReserved:'0',unitMixedActive:'0',unitMixedReserved:'0'},
  };
  const prior = Psbt.fromBase64(sample.priorPsbt);
  const priorTxid = Transaction.fromBuffer(prior.data.globalMap.unsignedTx.toBuffer()).getId();
  const fetchImpl = jest.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.includes('/outspend/')) return new Response(JSON.stringify({spent:false}));
    const txid = path.split('/').at(-1);
    if (txid === priorTxid) return new Response(JSON.stringify({txid,
      vin:prior.txInputs.map(({sequence})=>({sequence})),
      vout:prior.txOutputs.map(({value,script})=>({value,scriptpubkey:Buffer.from(script).toString('hex')})),
    }));
    if (txid === 'aa'.repeat(32)) return new Response(JSON.stringify({txid,
      vout:[{value:10000,scriptpubkey:'5120'+sample.proto.proto_members[1].pubkey}],
    }));
    throw new Error(`Unexpected fixture fetch ${path}`);
  }) as jest.MockedFunction<typeof fetch>;
  const verification = new PsbtVerificationContext('mutinynet',{inventory,fetchImpl,profile:{
    id:'mutinynet',label:'Testnet',bitcoin_network:'signet',expected_validator_chain_network:'mutiny',
    validator_base_url:'https://validator.example',esplora_base_url:'https://esplora.example',
  }});
  const entries=[];
  for(const encoded of fixture.psbts) {
    const psbt=Psbt.fromBase64(encoded);
    const signInputs:SignInputs={};
    psbt.data.inputs.forEach((input,index)=>{
      const hex=input.witnessUtxo?.script.toString('hex');
      const owner=input.tapLeafScript?.length ? keys.record.vault.address
        : hex===keys.satsOutputScript.toString('hex') ? keys.record.sats.address
        : hex===keys.runesOutputScript.toString('hex') ? keys.record.runes.address : undefined;
      if(owner) (signInputs[owner]??=[]).push(index);
    });
    const prepared=preparePsbtForSigning(encoded,'mutinynet',keys,signInputs);
    await verification.verify(prepared.psbt,prepared.summary);
    entries.push(prepared);
  }
  return {entries,inventory,fetchImpl,keys,prior};
}
