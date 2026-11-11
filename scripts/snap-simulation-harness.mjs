#!/usr/bin/env node

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { installSnap } from '@metamask/snaps-simulation';

const require = createRequire(import.meta.url);
const { address: btcAddress, initEccLib, networks, opcodes, payments, Psbt, script: btcScript } = require('bitcoinjs-lib');
const ecc = require('@bitcoin-js/tiny-secp256k1-asmjs');

// Taproot tweak math (payments.p2tr / control blocks) needs an ECC backend.
initEccLib(ecc);

// BIP-0387 unspendable NUMS internal key — the BitVM3 assert output's internal key.
const UNSPENDABLE_TAPROOT_KEY = Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex');

// Must be an origin the Snap authorizes (see DUCAT_ALLOWED_ORIGINS). The published allowlist is
// HTTPS Ducat-only; override with DUCAT_HARNESS_ORIGIN for a local dev manifest if needed.
const DEFAULT_ORIGIN = 'https://app.ducatprotocol.com';
const DEFAULT_NETWORK = 'regtest';
const DEFAULT_SRP = 'test test test test test test test test test test test ball';
const REGTEST_GENESIS_HASH = '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206';
const HARNESS_UNIT_ASSET_ID = '123:45';
const GOLDEN_ACCOUNTS = {
  mainnet: {
    sats: { address: 'bc1quezrxxup6e9u62xusarwd3dd9kqp4lzawm4hpw', pubkey: '0378ac2dbefccd68ecb2f836d6253185473128c12b61ceea24ab57bf2fead5a818' },
    runes: { address: 'bc1ptj3kkp79g0rm9clk4u8tzq4w9lpv0c0h0qkd7tm8shahaxjtk90s626w8p', pubkey: '59fd22bc6c5e1bfff71f5b1b077128c7e134114bbbaef4ea78ec48bca969d254' },
    vault: { address: 'bc1pfxjt04zav87u476xfmpqdktr3zck0yce6a76gc6qyj5g2ue6v94qqlghkr', pubkey: 'a676f763c0752f0226ba4ab2975e2959f57f194b48d4213af47f2b208b81240e' },
    authCandidates: [{
      address: 'bc1quezrxxup6e9u62xusarwd3dd9kqp4lzawm4hpw',
      publicKey: '0378ac2dbefccd68ecb2f836d6253185473128c12b61ceea24ab57bf2fead5a818',
      addressType: 'p2wpkh',
      isPreferred: true,
    }],
  },
  mutinynet: {
    sats: { address: 'tb1qanzjvshhgn30dap5kvdkternn9cxm93fl9jxww', pubkey: '021e90a6f5a336d48c8ce4deb95d877c034423bc25b9a96a44d31ff5b1ea18f681' },
    runes: { address: 'tb1pp3lfgknyj7mhhqy29uqlcm9va2fn0v8rwcl9c0mzxnuhmeszaqqq99vk0t', pubkey: '1a87334dafde8825d32ef66e80e3e2c8cf82c7963151c64f6dd30a0cb927fdf6' },
    vault: { address: 'tb1pkcu75f6u7x8v2vhplks075y4gplfn3c5ry5p7hl96zaeu6x8v2hsu7dc3f', pubkey: '1318a7b327da6566078bccc88d969672132512258f01daa2e6800d237332cc47' },
    authCandidates: [{
      address: 'tb1qanzjvshhgn30dap5kvdkternn9cxm93fl9jxww',
      publicKey: '021e90a6f5a336d48c8ce4deb95d877c034423bc25b9a96a44d31ff5b1ea18f681',
      addressType: 'p2wpkh',
      isPreferred: true,
    }],
  },
  regtest: {
    sats: { address: 'bcrt1qanzjvshhgn30dap5kvdkternn9cxm93favtte8', pubkey: '021e90a6f5a336d48c8ce4deb95d877c034423bc25b9a96a44d31ff5b1ea18f681' },
    runes: { address: 'bcrt1pp3lfgknyj7mhhqy29uqlcm9va2fn0v8rwcl9c0mzxnuhmeszaqqqguxs63', pubkey: '1a87334dafde8825d32ef66e80e3e2c8cf82c7963151c64f6dd30a0cb927fdf6' },
    vault: { address: 'bcrt1pkcu75f6u7x8v2vhplks075y4gplfn3c5ry5p7hl96zaeu6x8v2hs3887yn', pubkey: '1318a7b327da6566078bccc88d969672132512258f01daa2e6800d237332cc47' },
    authCandidates: [{
      address: 'bcrt1qanzjvshhgn30dap5kvdkternn9cxm93favtte8',
      publicKey: '021e90a6f5a336d48c8ce4deb95d877c034423bc25b9a96a44d31ff5b1ea18f681',
      addressType: 'p2wpkh',
      isPreferred: true,
    }],
  },
};
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

function harnessProtoLatest() {
  const term = (key, value) => ({ group: 63, key, value: [value] });
  return {
    chain_network: 'regtest',
    proto_terms: [
      term(241, 0.1), term(242, 1.5), term(243, '11'.repeat(32)), term(244, 546),
      term(245, 0.01), term(246, 1.1), term(247, HARNESS_UNIT_ASSET_ID), term(248, 1),
      term(249, 1.5), term(250, 10_000),
    ],
  };
}

/**
 * Serves the minimum trusted regtest data surface needed by the signing
 * harness. Fixtures are registered independently before a synthetic PSBT is
 * submitted, so the production Snap still exercises its full verification
 * path inside SES.
 */
export function serveWalletDataFixture(port = 0) {
  const walletUtxos = new Map();
  const prevouts = new Map();

  return new Promise((resolveServer, rejectServer) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const json = (body, status = 200) => {
        response.setHeader('Content-Type', 'application/json');
        response.writeHead(status);
        response.end(JSON.stringify(body));
      };

      if (url.pathname === '/block-height/0') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(REGTEST_GENESIS_HASH);
        return;
      }
      if (url.pathname === '/api/proto/latest') {
        json(harnessProtoLatest());
        return;
      }
      const btcAddressMatch = /^\/address\/([^/]+)\/utxo$/u.exec(url.pathname);
      if (btcAddressMatch) {
        json(walletUtxos.get(decodeURIComponent(btcAddressMatch[1])) ?? []);
        return;
      }
      if (/^\/api\/address\/[^/]+$/u.test(url.pathname)) {
        json({ data: [] });
        return;
      }
      const spendMatch = /^\/tx\/([0-9a-f]{64})\/outspend\/([0-9]+)$/iu.exec(url.pathname);
      if (spendMatch) {
        const fixture = prevouts.get(`${spendMatch[1].toLowerCase()}:${Number(spendMatch[2])}`);
        json({ spent: fixture?.spent ?? false });
        return;
      }
      const txMatch = /^\/tx\/([0-9a-f]{64})$/iu.exec(url.pathname);
      if (txMatch) {
        const txid = txMatch[1].toLowerCase();
        const fixtures = [...prevouts.values()].filter((fixture) => fixture.txid === txid);
        if (!fixtures.length) {
          json({ error: 'not found' }, 404);
          return;
        }
        const vout = [];
        for (const fixture of fixtures) {
          vout[fixture.vout] = { scriptpubkey: fixture.scriptPubKey, value: fixture.valueSats };
        }
        json({ txid, vout });
        return;
      }
      json({ error: 'not found' }, 404);
    });

    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectServer(new Error('Unable to resolve wallet-data harness server address.'));
        return;
      }
      resolveServer({
        server,
        port: address.port,
        registerWalletUtxo(addressValue, fixture) {
          const rows = walletUtxos.get(addressValue) ?? [];
          rows.push({ txid: fixture.txid, vout: fixture.vout, value: fixture.valueSats });
          walletUtxos.set(addressValue, rows);
        },
        registerPrevout(fixture) {
          prevouts.set(`${fixture.txid}:${fixture.vout}`, { ...fixture, spent: fixture.spent ?? false });
        },
      });
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
  if (network === 'mainnet' || network === 'main') {
    return networks.bitcoin;
  }
  // regtest uses the `bcrt` HRP — distinct from testnet's `tb`. The snap derives
  // bcrt addresses on regtest, so the harness must build PSBTs against the
  // matching bitcoinjs network or toOutputScript rejects the address prefix.
  if (network === 'regtest') {
    return networks.regtest;
  }
  return networks.testnet;
}

export async function openDucatSnapHarness(options = {}) {
  const root = resolve(options.root ?? process.env.DUCAT_SNAP_DIR ?? process.cwd());
  const origin = options.origin ?? process.env.DUCAT_HARNESS_ORIGIN ?? DEFAULT_ORIGIN;
  const network = options.network ?? process.env.DUCAT_NETWORK ?? DEFAULT_NETWORK;
  const secretRecoveryPhrase = options.secretRecoveryPhrase ?? process.env.DUCAT_HARNESS_SRP ?? DEFAULT_SRP;
  const { server, port } = await serveSnapDirectory(root, options.port ?? 0);
  const walletData = network === 'regtest' ? await serveWalletDataFixture(options.walletDataPort ?? 0) : null;
  const snapId = `local:http://localhost:${port}`;
  let snap;
  try {
    const walletDataBaseUrl = walletData ? `http://127.0.0.1:${walletData.port}` : null;
    snap = await installSnap(snapId, {
      options: {
        secretRecoveryPhrase,
        state: walletDataBaseUrl
          ? {
              recentActions: [],
              selectedNetwork: network,
              networkEndpointOverrides: {
                [network]: {
                  validator_base_url: walletDataBaseUrl,
                  esplora_base_url: walletDataBaseUrl,
                  network_identity_verified: true,
                },
              },
            }
          : undefined,
      },
    });
  } catch (error) {
    await Promise.all([
      new Promise((resolveClose) => server.close(() => resolveClose(undefined))),
      walletData ? new Promise((resolveClose) => walletData.server.close(() => resolveClose(undefined))) : Promise.resolve(),
    ]);
    throw error;
  }

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

  const selected = await invoke('ducat_getNetwork');
  if (selected?.network !== network) {
    await invoke('ducat_switchNetwork', { network }, { approveDialog: true });
  } else {
    await invoke('ducat_switchNetwork', { network });
  }

  return {
    close: async () => {
      await snap.close?.();
      await Promise.all([
        new Promise((resolveClose, rejectClose) => {
          server.close((error) => (error ? rejectClose(error) : resolveClose(undefined)));
        }),
        walletData
          ? new Promise((resolveClose, rejectClose) => {
              walletData.server.close((error) => (error ? rejectClose(error) : resolveClose(undefined)));
            })
          : Promise.resolve(),
      ]);
    },
    getConfirmations: () => [...confirmations],
    getAccounts: () => invoke('ducat_getAccounts', { network }),
    invoke,
    network,
    origin,
    registerPrevout: (fixture) => {
      assertHarness(walletData, 'Synthetic prevout fixtures require the regtest harness network.');
      walletData.registerPrevout(fixture);
    },
    registerWalletUtxo: (address, fixture) => {
      assertHarness(walletData, 'Synthetic wallet fixtures require the regtest harness network.');
      walletData.registerWalletUtxo(address, fixture);
    },
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
    '  node scripts/snap-simulation-harness.mjs derivation-contract',
    '  node scripts/snap-simulation-harness.mjs smoke-signing',
    '  node scripts/snap-simulation-harness.mjs session [iterations]',
    '  node scripts/snap-simulation-harness.mjs bitvm3-reclaim',
    "  node scripts/snap-simulation-harness.mjs sign-psbt '<base64-psbt>' '<signInputs-json>'",
    '',
    'Environment:',
    `  DUCAT_NETWORK=${DEFAULT_NETWORK}`,
    `  DUCAT_HARNESS_ORIGIN=${DEFAULT_ORIGIN}`,
    '  DUCAT_SNAP_DIR=/path/to/snap/root',
  ].join('\n');
}

function publicAccountRecord(record) {
  return {
    sats: record?.sats,
    runes: record?.runes,
    vault: record?.vault,
    authCandidates: record?.authCandidates,
  };
}

async function runDerivationContract() {
  const network = process.env.DUCAT_NETWORK ?? DEFAULT_NETWORK;
  const expected = GOLDEN_ACCOUNTS[network];
  assertHarness(expected, `No derivation-contract golden record exists for ${network}.`);
  const installations = [];

  for (let index = 0; index < 2; index += 1) {
    const harness = await openDucatSnapHarness();
    try {
      installations.push(publicAccountRecord(await harness.getAccounts()));
    } finally {
      await harness.close();
    }
  }

  assertHarness(JSON.stringify(installations[0]) === JSON.stringify(expected), `${network} managed accounts changed from the pre-v1 golden record.`);
  assertHarness(JSON.stringify(installations[1]) === JSON.stringify(expected), `${network} fresh reinstall did not reproduce the golden record.`);
  console.log(JSON.stringify({ network, status: 'derivation-contract-verified', accounts: expected }, null, 2));
}

async function runSmokeSigning(harness) {
  const accounts = await harness.getAccounts();
  const satsAddress = accounts?.sats?.address;
  const satsPubkey = accounts?.sats?.pubkey;

  assertHarness(typeof satsAddress === 'string' && satsAddress.length > 0, 'ducat_getAccounts returned no sats address.');
  assertHarness(typeof satsPubkey === 'string' && /^[0-9a-f]{66}$/iu.test(satsPubkey), 'ducat_getAccounts returned no compressed sats pubkey.');

  const inputValueSats = 100_000;
  const bitcoinJsNetwork = bitcoinNetwork(harness.network);
  const txid = '07'.repeat(32);
  harness.registerWalletUtxo(satsAddress, { txid, vout: 0, valueSats: inputValueSats });
  const psbt = new Psbt({ network: bitcoinJsNetwork });
  psbt.addInput({
    hash: txid,
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

// Snap-vs-harness bisection for the intermittent Flask crash.
//
// The dapp intermittently dies with "Extension context invalidated" at the
// open->first-action boundary — a SEQUENCE of sign requests through one wallet
// session. This drives that exact cadence (one installed snap, N sequential
// signPsbt calls + interleaved getAccounts reads, every dialog auto-approved)
// through the REAL SES executor, without MetaMask/MV3/the browser. If the
// session stays healthy here, the snap is sound and the Flask crash is an
// MV3/extension-harness problem; if it breaks here too, the snap has a real
// lifecycle/state bug.
async function runSession(harness, iterations) {
  const accounts = await harness.getAccounts();
  const satsAddress = accounts?.sats?.address;
  assertHarness(typeof satsAddress === 'string' && satsAddress.length > 0, 'ducat_getAccounts returned no sats address.');

  const bitcoinJsNetwork = bitcoinNetwork(harness.network);
  const legs = [];
  for (let i = 0; i < iterations; i++) {
    harness.registerWalletUtxo(satsAddress, {
      txid: Buffer.alloc(32, (i % 250) + 1).toString('hex'),
      vout: 0,
      valueSats: 100_000,
    });
  }
  for (let i = 0; i < iterations; i++) {
    // Fresh PSBT per leg (distinct prevout) — mirrors a new action each time.
    const psbt = new Psbt({ network: bitcoinJsNetwork });
    const txid = Buffer.alloc(32, (i % 250) + 1).toString('hex');
    psbt.addInput({
      hash: txid,
      index: 0,
      witnessUtxo: { script: btcAddress.toOutputScript(satsAddress, bitcoinJsNetwork), value: 100_000 },
    });
    psbt.addOutput({ address: satsAddress, value: 99_000 });

    const result = await harness.signPsbt(psbt.toBase64(), { [satsAddress]: [0] }, { actionType: `session-leg-${i}`, title: `Session leg ${i}` });
    const signed = Psbt.fromBase64(result.psbt, { network: bitcoinJsNetwork });
    const sigs = signed.data.inputs[0]?.partialSig ?? [];
    assertHarness(sigs.length === 1, `leg ${i}: expected 1 partial signature, got ${sigs.length}.`);

    // Interleave a no-sign read (mirrors the dapp's between-action vault-state
    // refetch) and prove the executor stays responsive across the session.
    if (i % 2 === 1) {
      const reread = await harness.getAccounts();
      assertHarness(reread?.sats?.address === satsAddress, `leg ${i}: getAccounts drifted mid-session.`);
    }
    legs.push({ leg: i, signatureBytes: sigs[0].signature.length, status: 'signed' });
  }

  const finalAccounts = await harness.getAccounts();
  assertHarness(finalAccounts?.sats?.address === satsAddress, 'getAccounts unhealthy after the session burst.');

  console.log(JSON.stringify({ network: harness.network, origin: harness.origin, iterations, legs, status: 'session-healthy' }, null, 2));
}

// Build the BitVM3 disprove leaf: OP_SHA256 <H(L*)> OP_EQUALVERIFY OP_1.
function bitvm3DisproveLeaf(labelHash) {
  return btcScript.compile([opcodes.OP_SHA256, labelHash, opcodes.OP_EQUALVERIFY, opcodes.OP_1]);
}

// Build the BitVM3 timeout leaf: <Δ> OP_CSV OP_DROP <operator_pk> OP_CHECKSIG.
function bitvm3TimeoutLeaf(challengeWindow, operatorXOnlyPubkey) {
  return btcScript.compile([
    btcScript.number.encode(challengeWindow),
    opcodes.OP_CHECKSEQUENCEVERIFY,
    opcodes.OP_DROP,
    operatorXOnlyPubkey,
    opcodes.OP_CHECKSIG,
  ]);
}

// Build the real 2-leaf BitVM3 assert output [disprove, timeout] (NUMS-keyed),
// returning the spend material for the TIMEOUT leaf (the operator reclaim path).
function buildBitvm3AssertTimeout(operatorXOnlyPubkey, network, challengeWindow = 144) {
  const disprove = bitvm3DisproveLeaf(Buffer.alloc(32, 0xab));
  const timeout = bitvm3TimeoutLeaf(challengeWindow, operatorXOnlyPubkey);
  const payment = payments.p2tr({
    internalPubkey: UNSPENDABLE_TAPROOT_KEY,
    network,
    redeem: { output: timeout, redeemVersion: 0xc0 },
    scriptTree: [{ output: disprove }, { output: timeout }],
  });

  if (!payment.output || !payment.witness?.length) {
    throw new Error('Failed to build BitVM3 assert timeout payment.');
  }

  return { output: payment.output, timeoutLeaf: timeout, controlBlock: payment.witness[payment.witness.length - 1] };
}

/**
 * E2E: drive the Snap to sign a real BitVM3 unilateral-exit TIMEOUT (reclaim)
 * leaf with its OWN derived vault key, proving the timeout-leaf signer works
 * inside the simulated MetaMask. The assert output is the NUMS-keyed P2TR over
 * [disprove, timeout]; we spend the timeout leaf via the taproot script path.
 */
async function runBitvm3Reclaim(harness) {
  const accounts = await harness.getAccounts();
  const vaultPubkeyHex = accounts?.vault?.pubkey;
  assertHarness(
    typeof vaultPubkeyHex === 'string' && /^[0-9a-f]{64}$/iu.test(vaultPubkeyHex),
    'ducat_getAccounts returned no x-only vault pubkey.',
  );
  const vaultAddress = accounts?.vault?.address;
  assertHarness(typeof vaultAddress === 'string' && vaultAddress.length > 0, 'ducat_getAccounts returned no vault address.');

  const vaultPubkey = Buffer.from(vaultPubkeyHex, 'hex');
  const bitcoinJsNetwork = bitcoinNetwork(harness.network);
  const challengeWindow = 144;
  const assert = buildBitvm3AssertTimeout(vaultPubkey, bitcoinJsNetwork, challengeWindow);

  const bondSats = 50_000;
  const assertTxid = '55'.repeat(32);
  harness.registerPrevout({
    txid: assertTxid,
    vout: 0,
    valueSats: bondSats,
    scriptPubKey: assert.output.toString('hex'),
  });
  const psbt = new Psbt({ network: bitcoinJsNetwork });
  psbt.addInput({
    hash: assertTxid,
    index: 0,
    sequence: challengeWindow, // nSequence = Δ so OP_CSV is satisfiable on-chain.
    tapLeafScript: [{ controlBlock: assert.controlBlock, leafVersion: 0xc0, script: assert.timeoutLeaf }],
    witnessUtxo: { script: assert.output, value: bondSats },
  });
  psbt.addOutput({ address: vaultAddress, value: bondSats - 1_000 });

  const result = await harness.signPsbt(
    psbt.toBase64(),
    { [vaultAddress]: [0] },
    { actionType: 'bitvm3-reclaim', title: 'BitVM3 unilateral-exit reclaim' },
  );
  const signed = Psbt.fromBase64(result.psbt, { network: bitcoinJsNetwork });
  const tapScriptSig = signed.data.inputs[0]?.tapScriptSig ?? [];

  assertHarness(tapScriptSig.length === 1, `Expected one taproot script-path signature, got ${tapScriptSig.length}.`);
  const [sig] = tapScriptSig;
  assertHarness(
    Buffer.from(sig.pubkey).toString('hex') === vaultPubkeyHex,
    'Script-path signature pubkey does not match the Ducat vault account.',
  );
  assertHarness(sig.signature.length === 64 || sig.signature.length === 65, 'Script-path signature is not a Schnorr signature.');
  assertHarness(signed.data.inputs[0]?.tapKeySig === undefined, 'Unexpected key-path signature on a script-path spend.');

  // The confirmation dialog must surface the unilateral-exit framing (no guardian).
  const confirmations = harness.getConfirmations();
  const dialogText = confirmations.flatMap((c) => c.text).join('\n');
  assertHarness(/unilateral|timeout|reclaim/iu.test(dialogText), 'Confirmation dialog did not surface the unilateral-exit framing.');

  console.log(
    JSON.stringify(
      {
        status: 'signed',
        leafKind: 'bitvm3-timeout',
        network: harness.network,
        vaultPubkey: vaultPubkeyHex,
        challengeWindow,
        signatureBytes: sig.signature.length,
        confirmedUnilateralExit: true,
      },
      null,
      2,
    ),
  );
}

/**
 * Negative E2E: the Snap MUST REFUSE to sign a BitVM3 timeout leaf whose operator
 * key is NOT the derived vault key (an attacker's assert). Confirms the
 * vault-key-match guard in checkOwnedTaprootScriptPathInput.
 */
async function runBitvm3ReclaimReject(harness) {
  const bitcoinJsNetwork = bitcoinNetwork(harness.network);
  const accounts = await harness.getAccounts();
  const vaultAddress = accounts?.vault?.address;
  assertHarness(typeof vaultAddress === 'string' && vaultAddress.length > 0, 'ducat_getAccounts returned no vault address.');

  // A timeout leaf bound to a FOREIGN operator key (not this Snap's vault key).
  const foreignKey = Buffer.alloc(32, 0x07);
  const assert = buildBitvm3AssertTimeout(foreignKey, bitcoinJsNetwork, 144);
  const assertTxid = '56'.repeat(32);
  harness.registerPrevout({
    txid: assertTxid,
    vout: 0,
    valueSats: 50_000,
    scriptPubKey: assert.output.toString('hex'),
  });

  const psbt = new Psbt({ network: bitcoinJsNetwork });
  psbt.addInput({
    hash: assertTxid,
    index: 0,
    sequence: 144,
    tapLeafScript: [{ controlBlock: assert.controlBlock, leafVersion: 0xc0, script: assert.timeoutLeaf }],
    witnessUtxo: { script: assert.output, value: 50_000 },
  });
  psbt.addOutput({ address: vaultAddress, value: 49_000 });

  let rejected = false;
  let message = '';
  try {
    await harness.signPsbt(psbt.toBase64(), { [vaultAddress]: [0] }, { actionType: 'bitvm3-reclaim-reject', title: 'BitVM3 reclaim (foreign operator)' });
  } catch (error) {
    rejected = true;
    message = error instanceof Error ? error.message : String(error);
  }

  assertHarness(rejected, 'Snap SIGNED a foreign-operator timeout leaf — vault-key guard FAILED.');
  console.log(JSON.stringify({ status: 'rejected', reason: 'foreign operator key', detail: message.slice(0, 200) }, null, 2));
}

async function runCli() {
  const command = process.argv[2] ?? 'accounts';

  if (command === 'derivation-contract') {
    await runDerivationContract();
    return;
  }

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

    if (command === 'session') {
      const parsed = Number(process.argv[3] ?? '6');
      const iterations = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6;
      await runSession(harness, iterations);
      return;
    }

    if (command === 'bitvm3-reclaim') {
      await runBitvm3Reclaim(harness);
      return;
    }

    if (command === 'bitvm3-reclaim-reject') {
      await runBitvm3ReclaimReject(harness);
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
