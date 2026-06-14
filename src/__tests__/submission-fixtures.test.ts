import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { accountPublicSetFromRecord } from '../accounts';
import { confirmPsbt } from '../confirmations';
import { preparePsbtForSigning } from '../psbt';
import type { DucatActionContext, DucatNetwork, SignInputs, WalletAccountRecord } from '../types';

const fixtureDir = path.resolve(__dirname, '../../submission/fixtures');
const requiredActions = ['create', 'deposit', 'borrow', 'repay', 'withdraw', 'swap', 'liquidation', 'repossess'];
const requireFixtures = process.env.DUCAT_REQUIRE_SUBMISSION_FIXTURES === '1';

type CapturedFixture = {
  action: string;
  network: DucatNetwork;
  accounts: WalletAccountRecord;
  psbt: string;
  signInputs: SignInputs;
  context?: DucatActionContext;
  expectedConfirmationText: string[];
  capturedFrom: {
    frontendOrigin: string;
  };
};

type SnapRequestArgs = {
  method: string;
  params?: {
    content?: unknown;
    type?: string;
  };
};

function readFixture(action: string): CapturedFixture | null {
  const fixturePath = path.join(fixtureDir, `${action}.json`);

  if (!existsSync(fixturePath)) {
    return null;
  }

  return JSON.parse(readFileSync(fixturePath, 'utf8')) as CapturedFixture;
}

function setSnapDialogMock() {
  const request = jest.fn(async ({ method }: SnapRequestArgs) => {
    if (method === 'snap_dialog') {
      return true;
    }

    throw new Error(`Unexpected Snap method ${method}`);
  });

  (globalThis as unknown as { snap: { request: typeof request } }).snap = { request };

  return request;
}

function collectDialogText(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectDialogText);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as {
    children?: unknown;
    label?: unknown;
    props?: Record<string, unknown>;
    title?: unknown;
    value?: unknown;
  };
  const props = record.props ?? {};

  return [
    typeof record.value === 'string' ? record.value : null,
    typeof record.label === 'string' ? record.label : null,
    typeof record.title === 'string' ? record.title : null,
    typeof props.value === 'string' ? props.value : null,
    typeof props.extra === 'string' ? props.extra : null,
    typeof props.description === 'string' ? props.description : null,
    typeof props.label === 'string' ? props.label : null,
    typeof props.title === 'string' ? props.title : null,
    typeof props.tooltip === 'string' ? props.tooltip : null,
    ...collectDialogText(record.children),
    ...collectDialogText(props.children),
  ].filter((item): item is string => typeof item === 'string');
}

function dialogText(request: jest.Mock): string {
  const dialogCall = request.mock.calls.find(([arg]) => arg.method === 'snap_dialog');

  return collectDialogText(dialogCall?.[0].params?.content).join('\n');
}

describe('submission PSBT fixtures', () => {
  const fixtures = requiredActions.map((action) => ({ action, fixture: readFixture(action) }));
  const missing = fixtures.filter(({ fixture }) => !fixture).map(({ action }) => `${action}.json`);
  const present = fixtures.filter((entry): entry is { action: string; fixture: CapturedFixture } => !!entry.fixture);

  it('has all required fixture files when the submission gate requires them', () => {
    if (requireFixtures) {
      expect(missing).toEqual([]);
    } else {
      expect(Array.isArray(missing)).toBe(true);
    }
  });

  it('replays captured confirmation text from public account data', async () => {
    if (!present.length) {
      expect(requireFixtures).toBe(false);
      return;
    }

    for (const { action, fixture } of present) {
      const accountSet = accountPublicSetFromRecord(fixture.network, fixture.accounts);
      const prepared = preparePsbtForSigning(fixture.psbt, fixture.network, accountSet, fixture.signInputs);
      const request = setSnapDialogMock();

      await confirmPsbt({
        origin: fixture.capturedFrom.frontendOrigin,
        summary: prepared.summary,
        context: fixture.context,
      });

      const rendered = dialogText(request);

      for (const expectedText of fixture.expectedConfirmationText) {
        expect(rendered).toContain(expectedText);
      }

      expect(fixture.action).toBe(action);
    }
  });
});
