import assert from 'node:assert/strict';
import {
  progressFailure,
  validateMountedComposition,
  validateSuccessfulRun,
} from '../kimodo-shared-device-smoke-adjudication.mjs';

const mounted = {
  setup: { status: 'mounted' },
  volume: { active: true, ordinaryForeground: { mode: 'producer-foreground-opportunities' } },
  state: {
    status: 'mounted',
    mount: { foregroundConnected: true, loadHandlerInstalled: true },
    deviceTopology: 'same-device',
    queueTopology: 'exact-device-queue',
  },
};
assert.equal(validateMountedComposition(mounted), mounted.state);
assert.throws(
  () => validateMountedComposition({ ...mounted, setup: { status: 'failed' } }),
  /did not reach mounted/,
  'a device receipt or HUD cannot hide failed composition setup',
);
assert.throws(
  () => validateMountedComposition({ ...mounted, state: { ...mounted.state, deviceTopology: 'compatible-devices' } }),
  /same-device and queue topology/,
  'a merely compatible second device cannot satisfy the shared-device claim',
);
assert.throws(
  () => validateMountedComposition({ ...mounted, state: { ...mounted.state, queueTopology: 'separate-queues' } }),
  /same-device and queue topology/,
  'a separate queue cannot satisfy the exact shared queue claim',
);

const successfulRun = {
  status: 'succeeded',
  foregroundReceipts: [{ status: 'completed' }],
  runs: [{
    foregroundReceipts: [{ status: 'completed', submissionCount: 1, result: { status: 'submitted' } }],
    foregroundRunReport: {
      status: 'succeeded',
      receipts: [{ status: 'completed' }],
      services: [{ status: 'serviced', failures: [] }],
    },
    flameBefore: { frameCount: 10, simStepCount: 20 },
    flameAfter: { frameCount: 12, simStepCount: 22 },
    samples: [{ status: 'running', frameCount: 10 }, { status: 'running', frameCount: 12 }],
  }],
};
assert.equal(validateSuccessfulRun(successfulRun), successfulRun.runs[0]);
assert.throws(
  () => validateSuccessfulRun({ ...successfulRun, runs: [{ ...successfulRun.runs[0], foregroundReceipts: [] }] }),
  /current-run/,
  'historical page receipts cannot substitute for current-run evidence',
);
assert.throws(
  () => validateSuccessfulRun({ ...successfulRun, runs: [{ ...successfulRun.runs[0], foregroundReceipts: [{ status: 'failed-before-submission' }] }] }),
  /failed, canceled, or submission-free/,
);
assert.throws(
  () => validateSuccessfulRun({ ...successfulRun, runs: [{ ...successfulRun.runs[0], flameAfter: { frameCount: 10, simStepCount: 20 } }] }),
  /without positive same-run flame/,
);
assert.equal(progressFailure({ now: 10, deadline: 20, lastProgressAt: 9, noProgressTimeoutMs: 5, label: 'x', totalTimeoutMs: 20 }), null);
assert.equal(progressFailure({ now: 15, deadline: 20, lastProgressAt: 9, noProgressTimeoutMs: 5, label: 'x', totalTimeoutMs: 20 }).code, 'WEDGED');
assert.equal(progressFailure({ now: 20, deadline: 20, lastProgressAt: 19, noProgressTimeoutMs: 5, label: 'x', totalTimeoutMs: 20 }).code, 'TIMEOUT');

console.log('Kimodo shared-device smoke adjudication contracts passed');
