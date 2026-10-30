/** Public, deterministic sample data for confirmation tests and the native renderer preview. */
import { Buffer } from 'buffer';
import { DucatKeyNode } from '../../bip32';
import type { DucatVaultReturnData, PsbtSummary } from '../../types';
import { deriveAccountSetFromBaseNodes } from './accounts';

export function depositPreview() {
  const node = (byte: number) => DucatKeyNode.fromPrivateKey(Buffer.alloc(32, byte), Buffer.alloc(32, byte + 10));
  const keys = deriveAccountSetFromBaseNodes('mutinynet', node(1), node(2));
  const wallet = keys.record.sats.address;
  const vault = keys.record.vault.address;
  const data: DucatVaultReturnData = {
    actionFlag: 'd', actionType: 'deposit', outputIndex: 2, vaultOutputIndex: 0, isLocked: true,
    unitBalanceCents: 135_000, unitBalanceUnit: 1_350, unitPrice: 110_650,
    unitTimestamp: 1_793_318_400, collateralSats: 11_827_400, tholdPrice: 17_122,
  };
  const summary: PsbtSummary = {
    network: 'mutinynet', inputCount: 2, signedInputIndexes: [0, 1],
    signedInputs: [
      { index: 0, address: wallet, signingAddress: wallet, role: 'sats', valueSats: 1_050_000, verification: 'matched-account-output' },
      { index: 1, address: vault, signingAddress: vault, role: 'vault', valueSats: 10_827_400, verification: 'matched-account-output' },
    ],
    outputCount: 3, outputs: [
      { address: vault, scriptHex: keys.vaultOutputScript.toString('hex'), valueSats: 11_827_400, role: 'vault', isMine: true },
      { address: wallet, scriptHex: keys.satsOutputScript.toString('hex'), valueSats: 49_500, role: 'sats', isMine: true },
      { address: 'OP_RETURN', scriptHex: '6a', valueSats: 0, role: 'op_return', isMine: false, vaultData: data },
    ],
    feeSats: 500, inputValueSats: 11_877_400, signedInputValueSats: 11_877_400,
    outputValueSats: 11_876_900, selfOutputSats: 11_876_900, externalOutputSats: 0,
    vaultUpdates: [data], unitInputs: [], warnings: [],
    vaultBefore: { inputIndex: 1, collateralSats: 10_827_400, debtUnit: 1_350, liquidationPrice: 18_703 },
  };
  const funding: PsbtSummary = {
    ...summary, inputCount: 1, signedInputIndexes: [0],
    signedInputs: [{ ...summary.signedInputs[0], valueSats: 1_050_500 }],
    outputCount: 1, outputs: [{ ...summary.outputs[1], valueSats: 1_050_000 }],
    inputValueSats: 1_050_500, signedInputValueSats: 1_050_500,
    outputValueSats: 1_050_000, selfOutputSats: 1_050_000, vaultUpdates: [], vaultBefore: undefined,
  };
  return { summary, funding, wallet, vault, keys };
}
