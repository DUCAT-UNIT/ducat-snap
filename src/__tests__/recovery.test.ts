import { Psbt, Transaction, payments, script, opcodes } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import { DucatKeyNode } from '../bip32';
import { deriveAccountSetFromBaseNodes } from './helpers/accounts';
import { preparePsbtForSigning } from '../psbt';
import { verifyRecoveryReview } from '../recovery';
import proto from './fixtures/recovery-proto.json';

const core = require('./__mocks__/core-lib.cjs');
jest.mock('../network-profiles', () => ({ getEffectiveNetworkProfile: async () => ({
  validator_base_url: 'https://validator.example', expected_validator_chain_network: 'regtest', id: 'regtest',
}) }));
const fetchImpl = jest.fn(async () => new Response(JSON.stringify(proto), {status: 200}));
const GUARD = '466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27';
function fixture(mutation?: string) {
  const account = deriveAccountSetFromBaseNodes('regtest',
    DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 3), Buffer.alloc(32, 13)),
    DucatKeyNode.fromPrivateKey(Buffer.alloc(32, 4), Buffer.alloc(32, 14)));
  const owner = account.vaultInternalPubkey.toString('hex');
  const returned = { guard_members: [GUARD], price_commits: [], price_stamp: null,
    unit_price: null, thold_price: null, unit_balance: 0 };
  const vaultScript = Buffer.from(core.create_vault_output_script({...returned, client_pubkey: owner}), 'hex');
  const message = {target_coin_id: `${'aa'.repeat(32)}:0`, contract_id: proto.contract_id, client_pubkey: owner,
    output_index: 0, vault_return_script: core.encode_vault_return_script(proto, returned).hex};
  if (mutation === 'owner') message.client_pubkey = GUARD;
  if (mutation === 'contract') message.contract_id = 'ee'.repeat(32);
  const repair = new Psbt();
  repair.addInput({hash: 'dd'.repeat(32), index: 0, witnessUtxo: {value: 30_000, script: account.satsOutputScript}});
  repair.addOutput({value: 20_000, script: mutation === 'script' ? account.vaultOutputScript : vaultScript});
  repair.addOutput({value: 0, script: Buffer.from(core.encode_vault_recovery_message(message).hex, 'hex')});
  repair.addOutput({value: 9_500, script: account.satsOutputScript});
  if (mutation === 'duplicate') repair.addOutput({value: 100, script: vaultScript});
  return {account, repair, message, vaultScript};
}

it('reviews encoded repair owner, debt, collateral and contract without claiming ledger attestation', async () => {
  const {account, repair, message} = fixture();
  const prepared = preparePsbtForSigning(repair.toBase64(), 'regtest', account, {[account.record.sats.address]: [0]});
  await verifyRecoveryReview(prepared.psbt, prepared.summary, account, undefined, {fetchImpl});
  expect(prepared.summary.recovery).toEqual({action: 'repair', targetOutpoint: message.target_coin_id,
    contractId: proto.contract_id, replacementOwner: message.client_pubkey, guardians: [GUARD], encodedDebt: 0, collateralSats: 20_000});
});

it('rejects wrong owner, stale contract, changed custody and ambiguous recovery outputs', async () => {
  for (const mutation of ['owner', 'contract', 'script', 'duplicate']) {
    const {account, repair} = fixture(mutation);
    const prepared = preparePsbtForSigning(repair.toBase64(), 'regtest', account, {[account.record.sats.address]: [0]});
    await expect(verifyRecoveryReview(prepared.psbt, prepared.summary, account, undefined, {fetchImpl})).rejects.toThrow();
  }
});

it('binds return to its exact parent, owner/guardian leaf and selected BTC account', async () => {
  const {account, repair, vaultScript} = fixture();
  const parentTx = Transaction.fromBuffer(repair.data.globalMap.unsignedTx.toBuffer()).toHex();
  const parent = Transaction.fromHex(parentTx);
  const leaf = script.compile([account.vaultInternalPubkey, opcodes.OP_CHECKSIGVERIFY, Buffer.from(GUARD, 'hex'), opcodes.OP_CHECKSIG]);
  const payment = payments.p2tr({internalPubkey: Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex'),
    scriptTree: {output: leaf}, redeem: {output: leaf, redeemVersion: 0xc0}});
  expect(payment.output).toEqual(vaultScript);
  const returned = new Psbt();
  returned.addInput({hash: parent.getId(), index: 0, witnessUtxo: {value: 20_000, script: vaultScript},
    tapLeafScript: [{leafVersion: 0xc0, script: leaf, controlBlock: payment.witness![payment.witness!.length - 1]}]});
  returned.addOutput({value: 19_500, script: account.satsOutputScript});
  const prepare = () => preparePsbtForSigning(returned.toBase64(), 'regtest', account, {[account.record.vault.address]: [0]});
  const prepared = prepare();
  await verifyRecoveryReview(prepared.psbt, prepared.summary, account, {action: 'return', parentTx}, {fetchImpl});
  expect(prepared.summary.recovery?.parentOutpoint).toBe(`${parent.getId()}:0`);
  const other = parent.clone(); other.locktime = 1;
  await expect(verifyRecoveryReview(prepared.psbt, prepared.summary, account, {action: 'return', parentTx: other.toHex()}, {fetchImpl})).rejects.toThrow('exact');
  const changed = new Psbt();
  changed.addInput({hash: parent.getId(), index: 0, ...returned.data.inputs[0]});
  changed.addOutput({value: 19_500, script: account.runesOutputScript});
  const redirected = preparePsbtForSigning(changed.toBase64(), 'regtest', account, {[account.record.vault.address]: [0]});
  await expect(verifyRecoveryReview(redirected.psbt, redirected.summary, account, {action: 'return', parentTx}, {fetchImpl})).rejects.toThrow('destination');
});
