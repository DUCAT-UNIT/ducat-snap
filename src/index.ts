import type { OnHomePageHandler, OnInstallHandler, OnRpcRequestHandler } from '@metamask/snaps-sdk';

import { renderHomePage } from './home';
import { handleRpcRequest } from './rpc';
import { uiBanner, uiBox, uiHeading, uiMuted, uiRow, uiSection } from './ui';

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  return handleRpcRequest(origin, request);
};

export const onHomePage: OnHomePageHandler = async () => {
  return renderHomePage();
};

export const onInstall: OnInstallHandler = async () => {
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: uiBox([
        uiHeading('Ducat installed', 'lg'),
        uiSection([
          uiRow('Networks', 'Signet / Mutinynet'),
          uiRow('Accounts', 'Bitcoin testnet accounts from MetaMask SRP'),
          uiRow('Keys', 'Stay inside MetaMask'),
          uiRow('Approvals', 'Required for every message, PSBT, batch, and transfer'),
        ]),
        uiBanner('Mainnet disabled', 'info', 'Mainnet remains disabled until audit and allowlist approval.'),
        uiMuted('Use the Ducat web app for create, deposit, borrow, repay, withdraw, swap, and liquidation flows.'),
      ]),
    },
  });
};
