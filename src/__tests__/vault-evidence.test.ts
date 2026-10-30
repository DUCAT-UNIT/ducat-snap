import { Buffer } from 'buffer';
import { opcodes, script } from 'bitcoinjs-lib';
import sample from './fixtures/vault-actions.json';
import { bindVaultOutput, unitTransferEdicts, vaultDisplayProtocol, vaultOutputScript } from '../vault-evidence';
import { previousVaultState } from '../psbt';
import { verifiedVaultAction } from './helpers/vault-actions';
import { depositPreview } from './helpers/deposit-preview';

it.each(sample.scriptVectors)('matches the SDK Taproot script with $guardians guardians and $hashes hashes',({guardians,hashes,script:expected})=>{
  expect(vaultOutputScript(sample.account.vault.pubkey.slice(-64),guardians,hashes).toString('hex')).toBe(expected);
});
it('does not recognize redirected collateral or mismatched guardian and liquidation commitments',async()=>{
  const {entries,inventory,keys}=await verifiedVaultAction('deposit');
  const summary=entries[0].summary;
  for(const change of ['recipient','guardian','hash','client']){
    const data={...summary.vaultUpdates[0],collateralSats:undefined,vaultOutputIndex:undefined,collateralBalanceSats:undefined};
    const protocol=structuredClone(inventory.vaultProtocol!);
    const account=structuredClone(keys.record);
    const outputs=entries[0].psbt.txOutputs.map(o=>({value:o.value,script:o.script}));
    if(change==='recipient') outputs[0].script=keys.satsOutputScript;
    if(change==='guardian') protocol.guardians[0].pubkey=sample.proto.proto_members[1].pubkey;
    if(change==='hash') data.thresholdHashes=['ff'.repeat(20)];
    if(change==='client') account.vault.pubkey=account.sats.pubkey;
    bindVaultOutput(data,outputs,account,protocol);
    expect(data.collateralSats).toBeUndefined();expect(data.vaultOutputIndex).toBeUndefined();
  }
});
it('uses the protocol minimum and UNIT divisibility and binds prior state to its exact output',async()=>{
  const {entries,inventory,keys,prior}=await verifiedVaultAction('borrow');
  expect(entries[1].summary.vaultBefore).toMatchObject({collateralSats:10827400,collateralBalanceSats:10826400,debtUnit:1350});
  const protocol={...inventory.vaultProtocol!,unitDivisibility:3};
  const state=previousVaultState(prior,1,'mutinynet',keys.record,protocol);
  expect(state).toMatchObject({collateralBalanceSats:10826400,unitBalanceUnit:135});
  expect(previousVaultState(prior,0,'mutinynet',keys.record,protocol)).toBeUndefined();
  expect(vaultDisplayProtocol({...sample.proto,proto_assets:[]},'134:1')).toBeUndefined();
});
it('recognizes canonical UNIT transfer edicts but refuses ambiguous, malformed or unrelated assets',async()=>{
  const {entries}=await verifiedVaultAction('borrow');
  const outputs=entries[0].summary.outputs;
  expect(unitTransferEdicts(outputs,'134:1',2)).toEqual([{outputIndex:1,amountUnit:250,assetId:'134:1'}]);
  expect(unitTransferEdicts(outputs,'134:2',2)).toBeUndefined();
  expect(unitTransferEdicts([...outputs,outputs[3]],'134:1',2)).toBeUndefined();
  const malformed=[...outputs];
  malformed[3]={...outputs[3],scriptHex:script.compile([opcodes.OP_RETURN,opcodes.OP_13,Buffer.from('0080','hex')]).toString('hex')};
  expect(unitTransferEdicts(malformed,'134:1',2)).toBeUndefined();
});
it('never falls back to a guessed vault tree without protocol members',()=>{
  const {keys}=depositPreview();
  const data={actionFlag:'d' as const,actionType:'deposit',outputIndex:1,isLocked:false,unitBalanceCents:0,unitBalanceUnit:0,unitPrice:0,unitTimestamp:0,guardianIndexes:[0],thresholdHashes:[]};
  bindVaultOutput(data,[{value:10827400,script:keys.vaultOutputScript}],keys.record);
  expect(data).not.toHaveProperty('collateralSats');
});
