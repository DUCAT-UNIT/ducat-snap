#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredScreenshots = [
  '01-install-approval.png',
  '02-wallet-selector.png',
  '03-connected-accounts.png',
  '04-psbt-confirmation.png',
  '05-batch-confirmation.png',
  '06-message-confirmation.png',
  '07-transfer-confirmation.png',
  '08-snap-home.png',
];
const requiredFixtureActions = ['create', 'deposit', 'borrow', 'repay', 'withdraw', 'swap', 'liquidation', 'repossess'];
const requiredE2eScenarios = [
  'install',
  'update',
  'connect',
  'reload-reconnect',
  'create',
  'deposit',
  'borrow',
  'repay',
  'withdraw',
  'swap',
  'liquidation',
  'repossess',
  'reject-signature',
  'disable-reenable',
];

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);

  if (!existsSync(filePath)) {
    throw new Error(`Missing required JSON file: ${relativePath}`);
  }

  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoPendingTokens(label, value) {
  const tokens = String(value).match(/PENDING_[A-Z0-9_]+/gu) ?? [];

  assert(tokens.length === 0, `${label} still contains pending placeholder(s): ${[...new Set(tokens)].join(', ')}`);
}

function assertHttpsUrl(label, value) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty URL.`);

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }

  assert(url.protocol === 'https:', `${label} must use HTTPS: ${value}`);
}

function assertPng(relativePath) {
  const filePath = path.join(root, relativePath);

  assert(existsSync(filePath), `Missing required screenshot: ${relativePath}`);

  const signature = readFileSync(filePath).subarray(0, 8);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  assert(signature.equals(pngSignature), `Required screenshot is not a PNG file: ${relativePath}`);
}

function assertString(label, value) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string.`);
  assertNoPendingTokens(label, value);
}

function assertObject(label, value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
}

function assertArray(label, value) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array.`);
}

function assertRealPsbtFixture(action) {
  const relativePath = path.join('submission/fixtures', `${action}.json`);
  const fixture = readJson(relativePath);

  assert(fixture.action === action, `${relativePath} action must be ${action}.`);
  assert(fixture.network === 'signet' || fixture.network === 'mutinynet', `${relativePath} network must be signet or mutinynet.`);
  assertString(`${relativePath} psbt`, fixture.psbt);
  assert(fixture.psbt.startsWith('cHNidP'), `${relativePath} psbt must be a base64 PSBT.`);
  assertObject(`${relativePath} signInputs`, fixture.signInputs);
  assert(Object.keys(fixture.signInputs).length > 0, `${relativePath} signInputs must not be empty.`);
  assertArray(`${relativePath} expectedConfirmationText`, fixture.expectedConfirmationText);
  assertObject(`${relativePath} capturedFrom`, fixture.capturedFrom);

  for (const field of ['frontendCommit', 'snapCommit', 'clientSdkVersion', 'validatorUrl']) {
    assertString(`${relativePath} capturedFrom.${field}`, fixture.capturedFrom[field]);
  }

  assertHttpsUrl(`${relativePath} capturedFrom.validatorUrl`, fixture.capturedFrom.validatorUrl);
}

function assertE2eEvidence() {
  const evidence = readJson('submission/e2e/evidence.json');

  assert(evidence.network === 'signet' || evidence.network === 'mutinynet', 'submission/e2e/evidence.json network must be signet or mutinynet.');
  assertString('submission/e2e/evidence.json snapCandidateTag', evidence.snapCandidateTag);
  assertString('submission/e2e/evidence.json frontendCommit', evidence.frontendCommit);
  assertHttpsUrl('submission/e2e/evidence.json demoVideoUrl', evidence.demoVideoUrl);
  assertArray('submission/e2e/evidence.json scenarios', evidence.scenarios);

  const scenarios = new Map(evidence.scenarios.map((scenario) => [scenario.name, scenario]));

  for (const name of requiredE2eScenarios) {
    const scenario = scenarios.get(name);

    assertObject(`E2E scenario ${name}`, scenario);
    assert(scenario.status === 'passed', `E2E scenario ${name} must have status "passed".`);
    assertString(`E2E scenario ${name} evidence`, scenario.evidence);
  }
}

function npmPackageMetadata(packageName, version) {
  let output;

  try {
    output = execFileSync('npm', ['view', `${packageName}@${version}`, 'version', 'dist.shasum', 'dist.integrity', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`${packageName}@${version} is not published to npm or npm metadata is unavailable.`);
  }

  return JSON.parse(output);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function runCheck(failures, label, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`${label}: ${formatError(error)}`);
  }
}

const directory = readJson('submission/metamask-directory.json');
const allowlistSubmission = readText('submission/ALLOWLIST_SUBMISSION.md');
const externalGates = readText('submission/EXTERNAL_GATES.md');
const packageJson = readJson('package.json');
const failures = [];

runCheck(failures, 'Pending placeholders in submission metadata', () => {
  assertNoPendingTokens('submission/metamask-directory.json', JSON.stringify(directory));
});

runCheck(failures, 'Pending placeholders in allowlist draft', () => {
  assertNoPendingTokens('submission/ALLOWLIST_SUBMISSION.md', allowlistSubmission);
});

runCheck(failures, 'Pending placeholders in external gate tracker', () => {
  assertNoPendingTokens('submission/EXTERNAL_GATES.md', externalGates);
});

runCheck(failures, 'Audit report URL', () => {
  assertHttpsUrl('audit report URL', directory.audit.auditReportUrl);
});

runCheck(failures, 'Demo video URL', () => {
  assertHttpsUrl('demo video URL', directory.submissionAssets.demoVideoUrl);
});

for (const fileName of requiredScreenshots) {
  runCheck(failures, `Screenshot ${fileName}`, () => {
    assertPng(path.join('submission/screenshots', fileName));
  });
}

for (const action of requiredFixtureActions) {
  runCheck(failures, `Fixture ${action}`, () => {
    assertRealPsbtFixture(action);
  });
}

runCheck(failures, 'E2E evidence', assertE2eEvidence);

runCheck(failures, 'Published npm package metadata', () => {
  const npmMetadata = npmPackageMetadata(packageJson.name, packageJson.version);

  assert(npmMetadata.version === packageJson.version, `Published npm version mismatch. Expected ${packageJson.version}, got ${npmMetadata.version}.`);
  assert(npmMetadata['dist.shasum'] === directory.verification.packageShasum, 'Published npm shasum does not match submission metadata.');
  assert(npmMetadata['dist.integrity'] === directory.verification.packageIntegrity, 'Published npm integrity does not match submission metadata.');
});

if (failures.length > 0) {
  console.error(`Submission packet is not ready for MetaMask directory review:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Submission packet is ready for MetaMask directory review.');
}
