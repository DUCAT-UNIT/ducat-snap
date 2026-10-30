import { assertJSXElement } from '@metamask/snaps-sdk/jsx';
import { confirmBatch } from '../confirmations';
import { verifiedVaultAction, type SampleVaultAction } from './helpers/vault-actions';

let request: jest.Mock;
beforeEach(()=>{
  request=jest.fn(async({method})=>method==='snap_createInterface'?'vault-interface':true);
  (globalThis as unknown as {snap:unknown}).snap={request};
});
function content(){
  const tree=request.mock.calls.find(([args])=>args.method==='snap_createInterface')?.[0].params.ui;
  assertJSXElement(tree);return JSON.stringify(tree);
}
it.each<[SampleVaultAction,string,string,number]>([
  ['deposit','Deposit to your vault','0.01000000 BTC',1],
  ['withdraw','Withdraw from your vault','0.01000000 BTC',1],
  ['borrow','Borrow UNIT','250 UNIT',2],
  ['repay','Repay UNIT','350 UNIT',2],
  ['repayFull','Clear your vault debt','1,350 UNIT',2],
  ['open','Open your vault','1,350 UNIT',2],
])('renders the actual SDK %s package', async(action,title,amount,count)=>{
  const {entries}=await verifiedVaultAction(action);
  expect(entries).toHaveLength(count);
  const state=entries.at(-1)!.summary;
  expect(state.vaultUpdates[0].collateralSats).toBeDefined();
  if(action!=='open') expect(state.vaultBefore).toBeDefined();
  await confirmBatch({origin:'https://app.ducatprotocol.com',entries});
  const ui=content();
  expect(ui).toContain(title);expect(ui).toContain(amount);
  expect(ui).toContain('Addresses & signing details');
  expect(ui).not.toContain('Review your deposit');
  expect(ui).not.toContain('Calculation details');
  expect(ui).not.toContain('Verified UNIT inputs');
  expect(ui).not.toContain('Ducat app context');
  for(const entry of entries) for(const output of entry.summary.outputs.filter((output)=>output.role!=='op_return')) expect(ui).toContain(output.address);
  const transactions: {props:{isExpanded?:boolean;children:unknown[]}}[]=[];
  function visit(value: unknown, inAddressDetails=false, inTransaction=false) {
    if(!value || typeof value!=='object') return;
    const node=value as {type?:string;props?:{label?:string;isExpanded?:boolean;children?:unknown[]}};
    const details=inAddressDetails || node.props?.label==='Addresses & signing details';
    const transaction=node.type==='CollapsibleSection' && /^(Deposit BTC|Withdraw BTC|[12]\. )/.test(node.props?.label??'');
    if(inTransaction && node.type==='Copyable') expect(details).toBe(true);
    if(transaction) {
      transactions.push(node as {props:{isExpanded?:boolean;children:unknown[]}});
      expect(node.props?.isExpanded).toBe(false);
    }
    Object.values(value).forEach((child)=>visit(child,details,inTransaction||transaction));
  }
  visit(JSON.parse(ui));
  expect(transactions).toHaveLength(count);
});
it('shows actual BTC received on withdrawal separately from the fee deducted from collateral',async()=>{
  const {entries}=await verifiedVaultAction('withdraw');
  await confirmBatch({origin:'https://app.ducatprotocol.com',entries});
  expect(content()).toContain('You receive');expect(content()).toContain('0.01000000 BTC');
  expect(content()).toContain('500 sats');
  expect(entries[0].summary.vaultBefore!.collateralBalanceSats!-entries[0].summary.vaultUpdates[0].collateralBalanceSats!).toBe(1000500);
});
it('shows returned BTC on partial repayment and debt-free state on full repayment',async()=>{
  const partial=await verifiedVaultAction('repay');
  await confirmBatch({origin:'https://app.ducatprotocol.com',entries:partial.entries});
  expect(content()).toContain('BTC returned to you');expect(content()).toContain('0.01149500 BTC');
  request.mockClear();
  const full=await verifiedVaultAction('repayFull');
  await confirmBatch({origin:'https://app.ducatprotocol.com',entries:full.entries});
  expect(content()).toContain('0 UNIT');expect(content()).toContain('No UNIT debt');expect(content()).toContain('None');
  expect(content()).toContain('887% →');
  expect(content()).not.toContain('$0.00');
});
it('does not label unrelated transactions as the borrow package or invent debt from app metadata',async()=>{
  const {entries}=await verifiedVaultAction('borrow');
  entries[0].summary.transactionId='ff'.repeat(32);
  await confirmBatch({origin:'https://app.ducatprotocol.com',entries,context:{vault:{amountUnit:99999}}});
  expect(request.mock.calls.some(([args])=>args.method==='snap_createInterface')).toBe(false);
});
it('keeps the real deposit amount when old metadata is unavailable but the spent vault is verified',async()=>{
  const {entries}=await verifiedVaultAction('deposit');
  delete entries[0].summary.vaultBefore;
  await confirmBatch({origin:'https://app.ducatprotocol.com',entries});
  expect(content()).toContain('You deposit');expect(content()).toContain('0.01000000 BTC');
  expect(content()).toContain('— →');
});
