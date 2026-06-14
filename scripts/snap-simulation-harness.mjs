#!/usr/bin/env node

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { installSnap } from '@metamask/snaps-simulation';

const DEFAULT_ORIGIN = 'http://localhost:3000';
const DEFAULT_NETWORK = 'mutinynet';
const DEFAULT_SRP = 'test test test test test test test test test test test ball';
const MIME_TYPES = {
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
};

export function serveSnapDirectory(root, port = 0) {
  const rootPath = resolve(root);

  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((request, response) => {
      const urlPath = (request.url ?? '/').split('?')[0].replace(/^\//u, '');
      const filePath = resolve(rootPath, urlPath || 'snap.manifest.json');

      if (filePath !== rootPath && !filePath.startsWith(`${rootPath}/`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      let fileStat;

      try {
        fileStat = statSync(filePath);
      } catch {
        fileStat = null;
      }

      if (!fileStat?.isFile()) {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }

      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Content-Type', MIME_TYPES[extname(filePath)] ?? 'application/octet-stream');
      response.writeHead(200);
      createReadStream(filePath).pipe(response);
    });

    server.listen(port, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        rejectServer(new Error('Unable to resolve Snap harness server address.'));
        return;
      }

      resolveServer({ server, port: address.port });
    });
    server.on('error', rejectServer);
  });
}

export function collectInterfaceText(value) {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectInterfaceText);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const props = value.props ?? {};
  const candidates = [
    value.value,
    value.label,
    value.title,
    props.value,
    props.extra,
    props.description,
    props.label,
    props.title,
    props.tooltip,
  ].filter((item) => typeof item === 'string');

  return [...candidates, ...collectInterfaceText(value.children), ...collectInterfaceText(props.children)];
}

function unwrapSnapResponse(method, response) {
  if (!response?.response) {
    throw new Error(`Snap RPC ${method} returned no response envelope.`);
  }

  if (response.response.error !== undefined) {
    throw new Error(`Snap RPC ${method} failed: ${JSON.stringify(response.response.error)}`);
  }

  return response.response.result;
}

export async function openDucatSnapHarness(options = {}) {
  const root = resolve(options.root ?? process.env.DUCAT_SNAP_DIR ?? process.cwd());
  const origin = options.origin ?? process.env.DUCAT_HARNESS_ORIGIN ?? DEFAULT_ORIGIN;
  const network = options.network ?? process.env.DUCAT_NETWORK ?? DEFAULT_NETWORK;
  const secretRecoveryPhrase = options.secretRecoveryPhrase ?? process.env.DUCAT_HARNESS_SRP ?? DEFAULT_SRP;
  const { server, port } = await serveSnapDirectory(root, options.port ?? 0);
  const snapId = `local:http://localhost:${port}`;
  const snap = await installSnap(snapId, {
    options: {
      secretRecoveryPhrase,
    },
  });

  let dialogLock = Promise.resolve();
  const confirmations = [];

  const invoke = async (method, params = {}, options = {}) => {
    if (options.approveDialog) {
      const run = dialogLock.then(() => signWithDialog(method, params));

      dialogLock = run.then(
        () => undefined,
        () => undefined,
      );

      return run;
    }

    return unwrapSnapResponse(
      method,
      await snap.request({
        origin,
        method,
        params,
      }),
    );
  };

  const signWithDialog = async (method, params) => {
    const pending = snap.request({
      origin,
      method,
      params,
    });
    const confirmation = await pending.getInterface();

    if (confirmation?.type === 'confirmation') {
      confirmations.push({
        content: confirmation.content,
        method,
        text: [...new Set(collectInterfaceText(confirmation.content))],
      });
      await confirmation.ok();
    }

    return unwrapSnapResponse(method, await pending);
  };

  return {
    close: async () => {
      await snap.close?.();
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose(undefined)));
      });
    },
    getConfirmations: () => [...confirmations],
    getAccounts: () => invoke('ducat_getAccounts', { network }),
    invoke,
    origin,
    signBatch: (entries, context, entryNetwork = network) =>
      invoke('ducat_signBatch', { network: entryNetwork, entries, context }, { approveDialog: true }),
    signMessage: (address, message, context, messageNetwork = network) =>
      invoke('ducat_signMessage', { network: messageNetwork, address, message, context }, { approveDialog: true }),
    signPsbt: (psbt, signInputs, context, psbtNetwork = network) =>
      invoke('ducat_signPsbt', { network: psbtNetwork, psbt, signInputs, context }, { approveDialog: true }),
    snapId,
  };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/snap-simulation-harness.mjs accounts',
    "  node scripts/snap-simulation-harness.mjs sign-psbt '<base64-psbt>' '<signInputs-json>'",
    '',
    'Environment:',
    `  DUCAT_NETWORK=${DEFAULT_NETWORK}`,
    `  DUCAT_HARNESS_ORIGIN=${DEFAULT_ORIGIN}`,
    '  DUCAT_SNAP_DIR=/path/to/snap/root',
  ].join('\n');
}

async function runCli() {
  const command = process.argv[2] ?? 'accounts';
  const harness = await openDucatSnapHarness();

  try {
    if (command === 'accounts') {
      console.log(JSON.stringify(await harness.getAccounts(), null, 2));
      return;
    }

    if (command === 'sign-psbt') {
      const psbt = process.argv[3];
      const signInputs = process.argv[4] ? JSON.parse(process.argv[4]) : null;

      if (!psbt || !signInputs) {
        throw new Error(usage());
      }

      console.log(JSON.stringify(await harness.signPsbt(psbt, signInputs), null, 2));
      return;
    }

    throw new Error(usage());
  } finally {
    await harness.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
