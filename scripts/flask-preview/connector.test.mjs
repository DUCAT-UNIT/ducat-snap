import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverFlask, connectLocalSnap, SNAP_ID } from './connector.mjs';
const manifest = async () => ({ ok:true, json:async () => ({ proposedName:'Ducat', initialPermissions:{'endowment:rpc':{allowedOrigins:['http://localhost:3000']}} }) });
test('requests only the local Snap after checking the development artifact', async () => {
  const calls=[];
  const installed={id:SNAP_ID,enabled:true,blocked:false,version:'0.3.1'};
  const provider={ request:async request=>{calls.push(request);return {[SNAP_ID]:installed};} };
  assert.equal(await connectLocalSnap(provider,manifest),installed);
  assert.deepEqual(calls,[{method:'wallet_requestSnaps',params:{[SNAP_ID]:{}}}]);
});
test('never requests installation for an unavailable or wrong artifact', async () => {
  let count=0;
  const provider={request:async()=>{count++;}};
  await assert.rejects(connectLocalSnap(provider,async()=>({ok:false})),/unavailable/);
  await assert.rejects(connectLocalSnap(provider,async()=>({ok:true,json:async()=>({proposedName:'Other'})})),/expected/);
  assert.equal(count,0);
});
test('reports rejected, blocked and disabled installations without claiming success', async () => {
  await assert.rejects(connectLocalSnap({request:async()=>{throw Object.assign(new Error('rejected'),{code:4001});}},manifest),{code:4001});
  for (const state of [{enabled:false},{enabled:true,blocked:true},undefined]) {
    await assert.rejects(connectLocalSnap({request:async()=>({[SNAP_ID]:state})},manifest),/not enabled/);
  }
});
test('selects announced Flask even when another injected wallet is present', async () => {
  const scope=new EventTarget();
  scope.ethereum={request:async()=>{throw new Error('wrong wallet');}};
  const flask={request:async()=>null};
  scope.addEventListener('eip6963:requestProvider',()=>{
    const event=new Event('eip6963:announceProvider');
    event.detail={info:{rdns:'io.metamask.flask'},provider:flask};scope.dispatchEvent(event);
  });
  assert.equal(await discoverFlask(scope)(),flask);
});
test('rejects ordinary MetaMask and explains when Flask is absent', async () => {
  const scope=new EventTarget();
  scope.ethereum={request:async()=> 'MetaMask/v13'};
  await assert.rejects(discoverFlask(scope)(),/profile where MetaMask Flask is installed/);
});
