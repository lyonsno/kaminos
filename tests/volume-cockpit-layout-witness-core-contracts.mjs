import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TerminalWitnessError,
  assertAuthoredLayoutRestored,
  auditBrowserEvents,
  evaluateInitialLayoutAdmission,
  navigateWithBrowserDiagnostics,
  prepareScreenshotEvidence,
  publishScreenshotEvidence,
  rejectScreenshotEvidence,
  stageScreenshotEvidence,
} from '../volume-cockpit-layout-witness-contract.mjs';

const calls = [];
const firstTurnException = {
  method: 'Runtime.exceptionThrown',
  params: { exceptionDetails: { text: 'first target script failed', url: 'http://example.test/index.html' } },
};
const fakeSocket = {
  browserEvents: [],
  async call(method, params = {}) {
    calls.push({ method, params });
    if (method === 'Page.navigate') this.browserEvents.push(firstTurnException);
    return {};
  },
};
await navigateWithBrowserDiagnostics(fakeSocket, 'http://example.test/?kaminos_volume_smoke=1');
assert.deepEqual(calls.map(call => call.method), [
  'Page.enable',
  'Runtime.enable',
  'Log.enable',
  'Page.navigate',
]);
assert.throws(
  () => evaluateInitialLayoutAdmission({ receipt: null, status: '' }, fakeSocket.browserEvents),
  error => error instanceof TerminalWitnessError && /first target script failed/.test(error.message),
  'a first-turn target exception must remain visible after pre-navigation diagnostic admission',
);

assert.throws(
  () => evaluateInitialLayoutAdmission({
    receipt: {
      layoutIdentity: 'kaminos.volume.cockpit-layout.v1',
      phase: 'store-unavailable',
      persistenceAvailable: false,
      fallbackApplied: true,
      persistenceFailureReason: 'caller-selected layout store is offline',
    },
    status: 'layout persistence unavailable: caller-selected layout store is offline',
  }, []),
  error => (
    error instanceof TerminalWitnessError
    && /store-unavailable/.test(error.message)
    && /caller-selected layout store is offline/.test(error.message)
  ),
  'completed persistence fallback must fail immediately with source phase and reason',
);

assert.throws(
  () => auditBrowserEvents([{
    method: 'Runtime.consoleAPICalled',
    params: { type: 'error', args: [{ value: 'late edit failure' }] },
  }]),
  error => error instanceof TerminalWitnessError && /late edit failure/.test(error.message),
  'a browser error after admission must prevent a successful audit',
);
const expectedBlockedStoreEvent = {
  method: 'Log.entryAdded',
  params: {
    entry: {
      level: 'error',
      text: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
      url: 'http://example.test/api/volume-cockpit-layouts',
    },
  },
};
assert.throws(
  () => auditBrowserEvents([expectedBlockedStoreEvent]),
  TerminalWitnessError,
  'the expected outage stimulus must not be admitted before the explicit outage phase',
);
assert.equal(
  auditBrowserEvents([expectedBlockedStoreEvent], { allowExpectedLayoutStoreBlock: true })
    .allowedExpectedFailureCount,
  1,
);

const authored = {
  layoutId: 'layout-custom',
  layoutLabel: 'Operator Layout Witness',
  renamedGroupId: 'group-a',
  groupLabel: 'Operator Group Witness',
  movedControlId: 'volume-density',
  sourceGroupId: 'group-a',
  targetGroupId: 'group-b',
  controls: { 'volume-density': '3.75', 'volume-toggle': true },
};
const restored = {
  layout: { layoutId: 'layout-custom', label: 'Operator Layout Witness' },
  groups: [
    { id: 'group-a', label: 'Operator Group Witness', controls: ['volume-toggle'] },
    { id: 'group-b', label: 'Other', controls: ['volume-density'] },
  ],
  controls: { 'volume-density': '3.75', 'volume-toggle': true },
};
assert.equal(assertAuthoredLayoutRestored({ authored, reloaded: restored }).movedControlId, 'volume-density');
assert.throws(
  () => assertAuthoredLayoutRestored({
    authored,
    reloaded: {
      ...restored,
      groups: [
        { id: 'group-a', label: 'Operator Group Witness', controls: ['volume-toggle', 'volume-density'] },
        { id: 'group-b', label: 'Other', controls: [] },
      ],
    },
  }),
  /restored the moved control to its source group/,
  'write acknowledgement without restored authored placement must not pass reload evidence',
);

const screenshotRoot = mkdtempSync(join(tmpdir(), 'kaminos-layout-witness-screenshot-'));
try {
  const screenshotPath = join(screenshotRoot, 'layout.png');
  writeFileSync(screenshotPath, 'stale-prior-run');
  let screenshot = prepareScreenshotEvidence({ path: screenshotPath, runId: 'run-failure' });
  assert.equal(existsSync(screenshotPath), false, 'stale screenshot survived run initialization');
  screenshot = stageScreenshotEvidence(screenshot, Buffer.from('new-but-not-admitted'));
  screenshot = rejectScreenshotEvidence(screenshot);
  assert.deepEqual(
    { produced: screenshot.produced, published: screenshot.published, admitted: screenshot.admitted },
    { produced: true, published: false, admitted: false },
  );
  assert.equal(existsSync(screenshotPath), false, 'failed run published or retained a screenshot');

  screenshot = prepareScreenshotEvidence({ path: screenshotPath, runId: 'run-success' });
  screenshot = stageScreenshotEvidence(screenshot, Buffer.from('admitted-current-run'));
  screenshot = publishScreenshotEvidence(screenshot);
  assert.equal(readFileSync(screenshotPath, 'utf8'), 'admitted-current-run');
  assert.deepEqual(
    { produced: screenshot.produced, published: screenshot.published, admitted: screenshot.admitted },
    { produced: true, published: true, admitted: true },
  );
} finally {
  rmSync(screenshotRoot, { recursive: true, force: true });
}

console.log('volume cockpit layout witness core contracts passed');
