/** @fileoverview Exposes Snap lifecycle and request handlers and routes each event to its owning module. */
import type { OnHomePageHandler, OnInstallHandler, OnRpcRequestHandler, OnUserInputHandler } from '@metamask/snaps-sdk';

import { artifactPolicy } from './artifact-policy';
import { DEPOSIT_VAULT_TOGGLE, handleDepositVaultInput } from './confirmation-vault';
import { handleHomeNavigationInput, isHomeNavigationEvent, renderHomePage } from './home';
import { handleHomeUserInput } from './home-key-override';
import { handleHomeNetworkInput, isHomeNetworkEvent } from './home-network';
import { handleEndpointOverrideInput, isEndpointOverrideEvent } from './home-network-endpoints';
import { handleRpcRequest } from './rpc';
import { uiBox, uiHeading, uiMuted, uiRow, uiText, uiDivider } from './ui';

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  return handleRpcRequest(origin, request);
};

export const onHomePage: OnHomePageHandler = () => renderHomePage();

export const onUserInput: OnUserInputHandler = async (args) => {
  if ('name' in args.event && args.event.name === DEPOSIT_VAULT_TOGGLE) {
    return handleDepositVaultInput(args);
  }

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
        uiHeading('Your Ducat wallet is ready', 'lg'),
        uiMuted('Manage your Bitcoin and UNIT with MetaMask.'),
        uiDivider(),
        uiBox([
          uiHeading('Your keys stay in MetaMask', 'sm'),
          uiMuted('You approve every signature.'),
        ]),
        uiRow('Network', artifactPolicy().default_deployment === 'mutinynet' ? 'Testnet' : artifactPolicy().default_deployment === 'mainnet' ? 'Mainnet' : 'Regtest'),
        uiDivider(),
        uiText('Open Ducat to get started.'),
      ]),
    },
  });
};
