#!/usr/bin/env node

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { installSnap } from '@metamask/snaps-simulation';

const require = createRequire(import.meta.url);
const { address: btcAddress, networks, Psbt } = require('bitcoinjs-lib');

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
      const relativePath = relative(rootPath, filePath);

      if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
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
  return collectInterfaceTextValue(value, new WeakSet());
}

function collectInterfaceTextValue(value, visited) {
  if (typeof value === 'string') {
    return [value];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (visited.has(value)) {
    return [];
  }

  visited.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectInterfaceTextValue(item, visited));
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

  return [
    ...candidates,
    ...collectInterfaceTextValue(value.children, visited),
    ...collectInterfaceTextValue(props.children, visited),
  ];
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

function assertHarness(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function bitcoinNetwork(network) {
  return network === 'mainnet' || network === 'main' || network === 'alpha-mainnet' ? networks.bitcoin : networks.testnet;
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
    network,
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
    '  node scripts/snap-simulation-harness.mjs smoke-signing',
    "  node scripts/snap-simulation-harness.mjs sign-psbt '<base64-psbt>' '<signInputs-json>'",
    '',
    'Environment:',
    `  DUCAT_NETWORK=${DEFAULT_NETWORK}`,
    `  DUCAT_HARNESS_ORIGIN=${DEFAULT_ORIGIN}`,
    '  DUCAT_SNAP_DIR=/path/to/snap/root',
  ].join('\n');
}

async function runSmokeSigning(harness) {
  const accounts = await harness.getAccounts();
  const satsAddress = accounts?.sats?.address;
  const satsPubkey = accounts?.sats?.pubkey;

  assertHarness(typeof satsAddress === 'string' && satsAddress.length > 0, 'ducat_getAccounts returned no sats address.');
  assertHarness(typeof satsPubkey === 'string' && /^[0-9a-f]{66}$/iu.test(satsPubkey), 'ducat_getAccounts returned no compressed sats pubkey.');

  const inputValueSats = 100_000;
  const bitcoinJsNetwork = bitcoinNetwork(harness.network);
  const psbt = new Psbt({ network: bitcoinJsNetwork });
  psbt.addInput({
    hash: Buffer.alloc(32, 7).toString('hex'),
    index: 0,
    witnessUtxo: {
      script: btcAddress.toOutputScript(satsAddress, bitcoinJsNetwork),
      value: inputValueSats,
    },
  });
  psbt.addOutput({
    address: satsAddress,
    value: inputValueSats - 1_000,
  });

  const result = await harness.signPsbt(psbt.toBase64(), { [satsAddress]: [0] }, { actionType: 'smoke-signing', title: 'Harness smoke signing' });
  const signedPsbt = Psbt.fromBase64(result.psbt, { network: bitcoinJsNetwork });
  const partialSignatures = signedPsbt.data.inputs[0]?.partialSig ?? [];

  assertHarness(partialSignatures.length === 1, `Expected one partial signature on input 0, got ${partialSignatures.length}.`);

  const [signature] = partialSignatures;

  assertHarness(Buffer.from(signature.pubkey).toString('hex') === satsPubkey, 'Partial signature pubkey does not match the Ducat sats account.');
  assertHarness(signature.signature.length > 8, 'Partial signature is too short to be a valid DER signature with sighash byte.');
  assertHarness(signature.signature[signature.signature.length - 1] === 0x01, 'Partial signature does not use SIGHASH_ALL.');

  console.log(
    JSON.stringify(
      {
        address: satsAddress,
        inputIndex: 0,
        network: harness.network,
        pubkey: satsPubkey,
        signatureBytes: signature.signature.length,
        status: 'signed',
      },
      null,
      2,
    ),
  );
}

async function runCli() {
  const command = process.argv[2] ?? 'accounts';
  const harness = await openDucatSnapHarness();

  try {
    if (command === 'accounts') {
      console.log(JSON.stringify(await harness.getAccounts(), null, 2));
      return;
    }

    if (command === 'smoke-signing') {
      await runSmokeSigning(harness);
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
