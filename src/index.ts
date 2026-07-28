/** @fileoverview Exposes Snap lifecycle and request handlers and routes each event to its owning module. */
import type { OnHomePageHandler, OnInstallHandler, OnRpcRequestHandler, OnUserInputHandler } from '@metamask/snaps-sdk';

import { handleHomeNavigationInput, isHomeNavigationEvent, renderHomePage } from './home';
import { handleHomeUserInput } from './home-key-override';
import { handleHomeNetworkInput, isHomeNetworkEvent } from './home-network';
import { handleEndpointOverrideInput, isEndpointOverrideEvent } from './home-network-endpoints';
import { handleRpcRequest } from './rpc';
import { uiBanner, uiBox, uiHeading, uiMuted, uiRow, uiSection } from './ui';

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  return handleRpcRequest(origin, request);
};

export const onHomePage: OnHomePageHandler = async () => {
  return renderHomePage();
};

export const onUserInput: OnUserInputHandler = async (args) => {
  if ('name' in args.event && typeof args.event.name === 'string' && isHomeNavigationEvent(args.event.name)) {
    return handleHomeNavigationInput(args);
  }

  if ('name' in args.event && typeof args.event.name === 'string' && isHomeNetworkEvent(args.event.name)) {
    return handleHomeNetworkInput(args);
  }

  if ('name' in args.event && typeof args.event.name === 'string' && isEndpointOverrideEvent(args.event.name)) {
    return handleEndpointOverrideInput(args);
  }

  return handleHomeUserInput(args);
};

export const onInstall: OnInstallHandler = async () => {
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: uiBox([
        uiHeading('Ducat installed', 'lg'),
        uiSection([
          uiRow('Networks', 'Mainnet / Signet / Mutinynet'),
          uiRow('Accounts', 'Bitcoin accounts from MetaMask SRP'),
          uiRow('Keys', 'Stay inside MetaMask'),
          uiRow('Approvals', 'Required for every message, PSBT, batch, and transfer'),
        ]),
        uiBanner('Mainnet enabled', 'warning', 'Mainnet requests use distinct Bitcoin mainnet derivation paths and require the same MetaMask confirmations.'),
        uiMuted('Use the Ducat web app for create, deposit, borrow, repay, withdraw, swap, and liquidation flows.'),
      ]),
    },
  });
};
