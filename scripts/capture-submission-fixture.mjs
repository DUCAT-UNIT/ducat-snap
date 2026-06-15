#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openDucatSnapHarness } from './snap-simulation-harness.mjs';

const REQUIRED_ACTIONS = new Set(['create', 'deposit', 'borrow', 'repay', 'withdraw', 'swap', 'liquidation', 'repossess']);

function usage() {
  return [
    'Usage:',
    '  node scripts/capture-submission-fixture.mjs draft.json [output.json]',
    '',
    'Draft shape:',
    '  {',
    '    "action": "deposit",',
    '    "network": "mutinynet",',
    '    "psbt": "cHNidP...",',
    '    "signInputs": { "tb1...": [0] },',
    '    "context": {},',
    '    "capturedFrom": {',
    '      "frontendOrigin": "http://localhost:3002",',
    '      "clientSdkVersion": "...",',
    '      "validatorUrl": "https://...",',
    '      "frontendCommit": "40-hex",',
    '      "snapCommit": "40-hex"',
    '    }',
    '  }',
  ].join('\n');
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing draft fixture input: ${filePath}`);
  }

  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function assertDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new Error('Fixture draft must be a JSON object.');
  }

  if (!REQUIRED_ACTIONS.has(draft.action)) {
    throw new Error(`Fixture action must be one of: ${[...REQUIRED_ACTIONS].join(', ')}`);
  }

  if (draft.network !== 'mainnet' && draft.network !== 'signet' && draft.network !== 'mutinynet') {
    throw new Error('Fixture network must be mainnet, signet, or mutinynet.');
  }

  if (typeof draft.psbt !== 'string' || !draft.psbt.startsWith('cHNidP')) {
    throw new Error('Fixture draft psbt must be a base64 PSBT string.');
  }

  if (!draft.signInputs || typeof draft.signInputs !== 'object' || Array.isArray(draft.signInputs)) {
    throw new Error('Fixture draft signInputs must be an object keyed by account address.');
  }
}

async function captureFixture(inputPath, outputPath) {
  const draft = readJson(inputPath);

  assertDraft(draft);

  const harness = await openDucatSnapHarness({
    network: draft.network,
    origin: draft.capturedFrom?.frontendOrigin,
  });

  try {
    const accounts = await harness.getAccounts();

    await harness.signPsbt(draft.psbt, draft.signInputs, draft.context, draft.network);

    const [confirmation] = harness.getConfirmations();
    const expectedConfirmationText = draft.expectedConfirmationText ?? confirmation?.text ?? [];
    const fixture = {
      action: draft.action,
      network: draft.network,
      accounts,
      psbt: draft.psbt,
      signInputs: draft.signInputs,
      ...(draft.context ? { context: draft.context } : {}),
      expectedConfirmationText,
      capturedFrom: {
        frontendOrigin: draft.capturedFrom?.frontendOrigin ?? harness.origin,
        clientSdkVersion: draft.capturedFrom?.clientSdkVersion ?? 'PENDING_CLIENT_SDK_VERSION',
        validatorUrl: draft.capturedFrom?.validatorUrl ?? 'PENDING_VALIDATOR_URL',
        frontendCommit: draft.capturedFrom?.frontendCommit ?? 'PENDING_FRONTEND_COMMIT',
        snapCommit: draft.capturedFrom?.snapCommit ?? 'PENDING_SNAP_COMMIT',
      },
    };

    writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(outputPath);
  } finally {
    await harness.close();
  }
}

async function runCli() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error(usage());
  }

  const draft = readJson(inputPath);
  const outputPath = process.argv[3] ?? path.resolve('submission/fixtures', `${draft.action ?? 'fixture'}.json`);

  await captureFixture(inputPath, outputPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
