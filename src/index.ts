import type { OnHomePageHandler, OnInstallHandler, OnRpcRequestHandler } from '@metamask/snaps-sdk';

import { renderHomePage } from './home';
import { handleRpcRequest } from './rpc';
import { heading, panel, text } from './ui';

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  return handleRpcRequest(origin, request);
};

export const onHomePage: OnHomePageHandler = async () => {
  return renderHomePage('mutinynet');
};

export const onInstall: OnInstallHandler = async () => {
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: panel([
        heading('Ducat installed'),
        text('Use the Ducat web app to connect MetaMask and sign Ducat actions on signet or mutinynet. Mainnet is not enabled in this release.'),
      ]),
    },
  });
};
