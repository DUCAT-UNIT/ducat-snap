#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
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
const allowedFixtureFiles = new Set(['README.md', ...requiredFixtureActions.map((action) => `${action}.json`)]);
const allowedScreenshotFiles = new Set(['.gitkeep', 'README.md', ...requiredScreenshots]);
const allowedE2eFiles = new Set(['README.md', 'evidence.json']);
const minimumScreenshotWidth = 360;
const minimumScreenshotHeight = 360;
const gitCommitHashPattern = /^[0-9a-f]{40}$/iu;
const maximumFixtureSignInputs = 80;
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

  const contents = readFileSync(filePath);
  const signature = contents.subarray(0, 8);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  assert(signature.equals(pngSignature), `Required screenshot is not a PNG file: ${relativePath}`);
  assert(contents.length >= 24, `Required screenshot is too small to be a valid PNG capture: ${relativePath}`);

  const ihdrType = contents.subarray(12, 16).toString('ascii');

  assert(ihdrType === 'IHDR', `Required screenshot is missing a PNG IHDR chunk: ${relativePath}`);

  const width = contents.readUInt32BE(16);
  const height = contents.readUInt32BE(20);

  assert(
    width >= minimumScreenshotWidth && height >= minimumScreenshotHeight,
    `Required screenshot is too small (${width}x${height}). Expected at least ${minimumScreenshotWidth}x${minimumScreenshotHeight}: ${relativePath}`,
  );
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

function assertDirectoryContainsOnly(relativePath, allowedFileNames) {
  const directoryPath = path.join(root, relativePath);

  assert(existsSync(directoryPath), `Missing required directory: ${relativePath}`);

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    assert(entry.isFile(), `${relativePath} must not contain directories or special files: ${entry.name}`);
    assert(allowedFileNames.has(entry.name), `${relativePath} contains unexpected file: ${entry.name}`);
  }
}

function assertStringArray(label, value) {
  assertArray(label, value);

  const seen = new Set();

  for (const [index, item] of value.entries()) {
    assertString(`${label}[${index}]`, item);
    assert(!seen.has(item), `${label} must not contain duplicate text: ${item}`);
    seen.add(item);
  }
}

function assertHex(label, value, bytes) {
  assertString(label, value);
  assert(new RegExp(`^[0-9a-f]{${bytes * 2}}$`, 'iu').test(value), `${label} must be ${bytes} bytes of hex.`);
}

function assertGitCommitHash(label, value) {
  assertString(label, value);
  assert(gitCommitHashPattern.test(value), `${label} must be a 40-character git commit hash.`);
}

let cachedAuditCandidateCommit;

function auditCandidateCommit() {
  if (cachedAuditCandidateCommit) {
    return cachedAuditCandidateCommit;
  }

  try {
    cachedAuditCandidateCommit = execFileSync('git', ['rev-list', '-n', '1', directory.audit.candidateTag], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`Audit candidate tag does not resolve: ${directory.audit.candidateTag}`);
  }

  assertGitCommitHash(`audit candidate commit for ${directory.audit.candidateTag}`, cachedAuditCandidateCommit);

  return cachedAuditCandidateCommit;
}

function assertAccount(label, value, pubkeyBytes) {
  assertObject(label, value);
  assertString(`${label}.address`, value.address);
  assertHex(`${label}.pubkey`, value.pubkey, pubkeyBytes);
}

function assertAuthCandidate(label, value) {
  assertObject(label, value);
  assertString(`${label}.address`, value.address);
  assertHex(`${label}.publicKey`, value.publicKey, 33);

  if (value.addressType !== undefined) {
    assertString(`${label}.addressType`, value.addressType);
  }

  if (value.isPreferred !== undefined) {
    assert(typeof value.isPreferred === 'boolean', `${label}.isPreferred must be a boolean when present.`);
  }
}

function assertWalletAccountRecord(relativePath, accounts) {
  assertObject(`${relativePath} accounts`, accounts);
  assertAccount(`${relativePath} accounts.sats`, accounts.sats, 33);
  assertAccount(`${relativePath} accounts.runes`, accounts.runes, 32);
  assertAccount(`${relativePath} accounts.vault`, accounts.vault, 32);
  assertArray(`${relativePath} accounts.authCandidates`, accounts.authCandidates);

  accounts.authCandidates.forEach((candidate, index) => {
    assertAuthCandidate(`${relativePath} accounts.authCandidates[${index}]`, candidate);
  });

  assert(accounts.runes.address === accounts.vault.address, `${relativePath} accounts.runes.address must match accounts.vault.address for v0.1.0.`);
  assert(accounts.runes.pubkey === accounts.vault.pubkey, `${relativePath} accounts.runes.pubkey must match accounts.vault.pubkey for v0.1.0.`);
}

function assertSignInputs(label, value, accounts) {
  assertObject(label, value);

  const entries = Object.entries(value);
  const accountAddresses = new Set([accounts.sats.address, accounts.runes.address, accounts.vault.address]);
  const seenIndexes = new Set();
  let inputCount = 0;

  assert(entries.length > 0, `${label} must not be empty.`);

  for (const [address, indexes] of entries) {
    assertString(`${label} address`, address);
    assert(accountAddresses.has(address), `${label} address must belong to the fixture account record: ${address}`);
    assertArray(`${label}.${address}`, indexes);

    for (const index of indexes) {
      assert(Number.isSafeInteger(index) && index >= 0, `${label}.${address} contains an invalid PSBT input index: ${index}`);
      assert(!seenIndexes.has(index), `${label} contains a duplicate PSBT input index: ${index}`);

      seenIndexes.add(index);
      inputCount += 1;

      assert(inputCount <= maximumFixtureSignInputs, `${label} requests too many input signatures for one fixture. Max: ${maximumFixtureSignInputs}`);
    }
  }
}

function assertRealPsbtFixture(action) {
  const relativePath = path.join('submission/fixtures', `${action}.json`);
  const fixture = readJson(relativePath);

  assert(fixture.action === action, `${relativePath} action must be ${action}.`);
  assert(fixture.network === 'signet' || fixture.network === 'mutinynet', `${relativePath} network must be signet or mutinynet.`);
  assertWalletAccountRecord(relativePath, fixture.accounts);
  assertString(`${relativePath} psbt`, fixture.psbt);
  assert(fixture.psbt.startsWith('cHNidP'), `${relativePath} psbt must be a base64 PSBT.`);
  assertSignInputs(`${relativePath} signInputs`, fixture.signInputs, fixture.accounts);
  assertStringArray(`${relativePath} expectedConfirmationText`, fixture.expectedConfirmationText);
  assertObject(`${relativePath} capturedFrom`, fixture.capturedFrom);

  for (const field of ['clientSdkVersion', 'validatorUrl']) {
    assertString(`${relativePath} capturedFrom.${field}`, fixture.capturedFrom[field]);
  }

  assertGitCommitHash(`${relativePath} capturedFrom.frontendCommit`, fixture.capturedFrom.frontendCommit);
  assertGitCommitHash(`${relativePath} capturedFrom.snapCommit`, fixture.capturedFrom.snapCommit);
  assert(
    fixture.capturedFrom.snapCommit === auditCandidateCommit(),
    `${relativePath} capturedFrom.snapCommit must match ${directory.audit.candidateTag} (${auditCandidateCommit()}).`,
  );
  assertHttpsUrl(`${relativePath} capturedFrom.frontendOrigin`, fixture.capturedFrom.frontendOrigin);
  assertHttpsUrl(`${relativePath} capturedFrom.validatorUrl`, fixture.capturedFrom.validatorUrl);
}

function fixturePath(action) {
  return path.join(root, 'submission/fixtures', `${action}.json`);
}

function allFixtureFilesExist() {
  return requiredFixtureActions.every((action) => existsSync(fixturePath(action)));
}

function assertFixtureConfirmationReplay() {
  let output;

  try {
    output = execFileSync('npm', ['test', '--', '--runTestsByPath', 'src/__tests__/submission-fixtures.test.ts', '--runInBand'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DUCAT_REQUIRE_SUBMISSION_FIXTURES: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    const details = `${stdout}\n${stderr}`.trim();

    throw new Error(details || 'Submission fixture replay failed.');
  }

  assert(output.includes('PASS'), 'Submission fixture replay did not report a passing Jest run.');
}

function assertE2eEvidence() {
  const evidence = readJson('submission/e2e/evidence.json');

  assert(evidence.network === 'signet' || evidence.network === 'mutinynet', 'submission/e2e/evidence.json network must be signet or mutinynet.');
  assertString('submission/e2e/evidence.json snapCandidateTag', evidence.snapCandidateTag);
  assert(evidence.snapCandidateTag === directory.audit.candidateTag, `submission/e2e/evidence.json snapCandidateTag must match ${directory.audit.candidateTag}.`);
  assertGitCommitHash('submission/e2e/evidence.json snapCommit', evidence.snapCommit);
  assert(evidence.snapCommit === auditCandidateCommit(), `submission/e2e/evidence.json snapCommit must match ${directory.audit.candidateTag} (${auditCandidateCommit()}).`);
  assertGitCommitHash('submission/e2e/evidence.json frontendCommit', evidence.frontendCommit);
  assertString('submission/e2e/evidence.json packageShasum', evidence.packageShasum);
  assertString('submission/e2e/evidence.json manifestSourceShasum', evidence.manifestSourceShasum);
  assert(evidence.packageShasum === directory.verification.packageShasum, 'submission/e2e/evidence.json packageShasum must match submission metadata.');
  assert(evidence.manifestSourceShasum === directory.verification.manifestSourceShasum, 'submission/e2e/evidence.json manifestSourceShasum must match submission metadata.');
  assertHttpsUrl('submission/e2e/evidence.json demoVideoUrl', evidence.demoVideoUrl);
  assert(evidence.demoVideoUrl === directory.submissionAssets.demoVideoUrl, 'submission/e2e/evidence.json demoVideoUrl must match submission metadata.');
  assertArray('submission/e2e/evidence.json scenarios', evidence.scenarios);

  const scenarios = new Map(evidence.scenarios.map((scenario) => [scenario.name, scenario]));

  assert(scenarios.size === evidence.scenarios.length, 'submission/e2e/evidence.json scenarios must not contain duplicate names.');

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

runCheck(failures, 'Unexpected fixture artifacts', () => {
  assertDirectoryContainsOnly('submission/fixtures', allowedFixtureFiles);
});

runCheck(failures, 'Unexpected screenshot artifacts', () => {
  assertDirectoryContainsOnly('submission/screenshots', allowedScreenshotFiles);
});

runCheck(failures, 'Unexpected E2E artifacts', () => {
  assertDirectoryContainsOnly('submission/e2e', allowedE2eFiles);
});

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

if (allFixtureFilesExist()) {
  runCheck(failures, 'Fixture confirmation replay', assertFixtureConfirmationReplay);
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
