import assert from 'node:assert/strict';
import {
  boundedCleanup,
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
    runId: 'run-current',
    foregroundReceipts: [{ runId: 'run-current', status: 'completed', submissionCount: 1, result: { status: 'submitted' } }],
    foregroundRunReport: {
      runId: 'run-current',
      status: 'succeeded',
      receipts: [{ runId: 'run-current', status: 'completed', submissionCount: 1, result: { status: 'submitted' } }],
      services: [{ runId: 'run-current', status: 'serviced', failures: [] }],
    },
    flameBefore: { frameCount: 10, simStepCount: 20 },
    flameAfter: { frameCount: 12, simStepCount: 22 },
    samples: [{ status: 'running', frameCount: 10 }, { status: 'running', frameCount: 12 }],
  }],
};
assert.equal(validateSuccessfulRun(successfulRun), successfulRun.runs[0]);
assert.throws(
  () => validateSuccessfulRun(successfulRun, 'fence-light'),
  /schedule/,
  'requested split cannot close on missing or full-pass effective scheduling',
);

function scheduledRun({ generationId = 9, observedBoundaries = 16, diagnosticGenerationId = generationId, scheduleMode = 'fence-light' } = {}) {
  const runId = 'run-current';
  const schedule = {
    'fence-light': { layersPerDuty: 4, chunksPerPass: 4, maxInFlightDuties: 4 },
    'single-layer': { layersPerDuty: 1, chunksPerPass: 16, maxInFlightDuties: 4 },
  }[scheduleMode];
  const { layersPerDuty, chunksPerPass, maxInFlightDuties } = schedule;
  const steps = 1;
  const passNames = ['cond-root', 'cond-body', 'uncond-root', 'uncond-body'];
  const passes = [], duties = [];
  for (let step = 1; step <= steps; step++) {
    for (const pass of passNames) {
      for (let chunkIndex = 1; chunkIndex <= chunksPerPass; chunkIndex++) {
        const dutyId = `g${generationId}-s${step}-${pass}-c${chunkIndex}`;
        passes.push({
          dutyId, step, numSteps: steps, pass, chunkIndex, chunkCount: chunksPerPass,
          layerStart: (chunkIndex - 1) * layersPerDuty,
          layerEnd: chunkIndex * layersPerDuty,
        });
        duties.push({ dutyId, sequence: duties.length + 1, status: 'completed' });
      }
    }
  }
  const expected = steps * passNames.length * chunksPerPass;
  const summary = {
    status: 'drained', maxInFlightDuties, maxObservedInFlightDuties: maxInFlightDuties,
    submittedDutyCount: expected, completedDutyCount: expected, failedDutyCount: 0, inFlightDutyCount: 0,
  };
  return {
    ...successfulRun.runs[0],
    runId,
    generationId,
    steps,
    scheduling: { mode: scheduleMode, layersPerDuty, chunksPerPass, maxInFlightDuties },
    receipt: { generationId, metadata: { gpuSubmission: summary } },
    submission: summary,
    diagnostics: {
      generationId: diagnosticGenerationId,
      numSteps: steps,
      scheduleMode,
      scheduling: { mode: scheduleMode, layersPerDuty, chunksPerPass, maxInFlightDuties },
      passes,
      submissionReport: { status: 'drained', duties, ...summary },
    },
    telemetry: {
      status: 'succeeded', generationId,
      submission: summary,
      scheduler: {
        mode: 'cooperative-foreground-boundary',
        requestedMaxInFlightDuties: maxInFlightDuties,
        boundariesPerStep: 4 * chunksPerPass,
        expectedForegroundBoundaryCount: expected,
        observedForegroundBoundaryCount: observedBoundaries ?? expected,
        lastBoundary: { phase: 'ddim-sampling', ...passes.at(-1) },
      },
    },
  };
}
const scheduledTerminal = run => ({ status: 'succeeded', runs: [run] });
assert.equal(validateSuccessfulRun(scheduledTerminal(scheduledRun()), 'fence-light').generationId, 9);
assert.equal(
  validateSuccessfulRun(scheduledTerminal(scheduledRun({ scheduleMode: 'single-layer', observedBoundaries: null })), 'single-layer').diagnostics.passes.length,
  64,
  'single-layer terminal acceptance requires all sixteen layer duties in each of four passes',
);
assert.throws(
  () => validateSuccessfulRun(scheduledTerminal(scheduledRun({ scheduleMode: 'single-layer', observedBoundaries: 1 })), 'single-layer'),
  /boundary|telemetry/,
  'one foreground receipt cannot close a sixty-four-opportunity one-step single-layer schedule',
);
assert.throws(
  () => validateSuccessfulRun(scheduledTerminal(scheduledRun({ diagnosticGenerationId: 1 })), 'fence-light'),
  /generation/,
  'a stale producer diagnostic generation cannot close a current receipt',
);
assert.throws(
  () => validateSuccessfulRun(scheduledTerminal({ ...scheduledRun(), telemetry: { status: 'succeeded', generationId: 9 } }), 'fence-light'),
  /boundary|telemetry/,
  'missing scheduler telemetry cannot imply complete foreground opportunities',
);
assert.throws(
  () => validateSuccessfulRun(scheduledTerminal(scheduledRun({ observedBoundaries: 1 })), 'fence-light'),
  /boundary|telemetry/,
  'one observed boundary cannot close sixteen expected opportunities',
);
assert.throws(
  () => validateSuccessfulRun(scheduledTerminal({ ...scheduledRun(), telemetry: { ...scheduledRun().telemetry, generationId: 1 } }), 'fence-light'),
  /generation|telemetry/,
  'stale telemetry generation cannot close a current producer run',
);
assert.throws(
  () => validateSuccessfulRun(scheduledTerminal({ ...scheduledRun(), telemetry: { ...scheduledRun().telemetry, scheduler: { ...scheduledRun().telemetry.scheduler, lastBoundary: { dutyId: 'g1-s1-uncond-body-c4' } } } }), 'fence-light'),
  /boundary/,
  'a stale or partial last-boundary row cannot close the schedule',
);
for (const [label, alter] of [
  ['duplicate', rows => { rows[1] = { ...rows[0] }; }],
  ['missing', rows => { rows.pop(); }],
  ['out-of-order', rows => { [rows[0], rows[1]] = [rows[1], rows[0]]; }],
  ['wrong-step', rows => { rows[0] = { ...rows[0], dutyId: rows[0].dutyId.replace('-s1-', '-s2-') }; }],
]) {
  const run = scheduledRun();
  const passes = [...run.diagnostics.passes];
  alter(passes);
  assert.throws(
    () => validateSuccessfulRun(scheduledTerminal({ ...run, diagnostics: { ...run.diagnostics, passes } }), 'fence-light'),
    /duty|chunk|generation|schedule/,
    `${label} producer duty identity is rejected`,
  );
}
{
  const run = scheduledRun();
  const passes = [...run.diagnostics.passes];
  passes[0] = { ...passes[0], step: 2 };
  assert.throws(
    () => validateSuccessfulRun(scheduledTerminal({ ...run, diagnostics: { ...run.diagnostics, passes } }), 'fence-light'),
    /duty|chunk|generation|schedule/,
    'producer pass rows carry and enforce their sampling-step identity',
  );
}
{
  const run = scheduledRun();
  const duties = [...run.diagnostics.submissionReport.duties];
  duties[0] = { ...duties[0], dutyId: 'g1-s1-cond-root-c1' };
  assert.throws(
    () => validateSuccessfulRun(scheduledTerminal({ ...run, diagnostics: { ...run.diagnostics, submissionReport: { ...run.diagnostics.submissionReport, duties } } }), 'fence-light'),
    /duty|chunk|generation|schedule/,
    'current receipt summary cannot hide a stale raw submission row',
  );
}
assert.throws(
  () => validateSuccessfulRun({ ...successfulRun, runs: [{ ...successfulRun.runs[0], foregroundReceipts: [] }] }),
  /current-run/,
  'historical page receipts cannot substitute for current-run evidence',
);
assert.throws(
  () => validateSuccessfulRun({ ...successfulRun, runs: [{ ...successfulRun.runs[0], foregroundReceipts: [{ runId: 'run-current', status: 'failed-before-submission' }] }] }),
  /failed, canceled, or submission-free/,
);
assert.throws(
  () => validateSuccessfulRun({
    ...successfulRun,
    runs: [{
      ...successfulRun.runs[0],
      foregroundReceipts: [{ runId: null, status: 'completed', submissionCount: 1, result: { status: 'submitted' } }],
      foregroundRunReport: { ...successfulRun.runs[0].foregroundRunReport, receipts: [] },
    }],
  }),
  /exact current run/,
  'a successful outside-run receipt cannot substitute for current-run evidence',
);
assert.throws(
  () => validateSuccessfulRun({
    ...successfulRun,
    runs: [{ ...successfulRun.runs[0], foregroundRunReport: { ...successfulRun.runs[0].foregroundRunReport, runId: 'run-prior' } }],
  }),
  /run report identity/,
  'a prior or later run report cannot close the current run',
);
assert.throws(
  () => validateSuccessfulRun({
    ...successfulRun,
    runs: [{
      ...successfulRun.runs[0],
      foregroundReceipts: [
        ...successfulRun.runs[0].foregroundReceipts,
        { runId: null, status: 'completed', submissionCount: 1, result: { status: 'submitted' } },
      ],
    }],
  }),
  /exact current run/,
  'mixed current-run and outside-run receipt slices are rejected rather than partially trusted',
);
assert.throws(
  () => validateSuccessfulRun({ ...successfulRun, runs: [{ ...successfulRun.runs[0], flameAfter: { frameCount: 10, simStepCount: 20 } }] }),
  /without positive same-run flame/,
);
assert.equal(progressFailure({ now: 10, deadline: 20, lastProgressAt: 9, noProgressTimeoutMs: 5, label: 'x', totalTimeoutMs: 20 }), null);
assert.equal(progressFailure({ now: 15, deadline: 20, lastProgressAt: 9, noProgressTimeoutMs: 5, label: 'x', totalTimeoutMs: 20 }).code, 'WEDGED');
assert.equal(progressFailure({ now: 20, deadline: 20, lastProgressAt: 19, noProgressTimeoutMs: 5, label: 'x', totalTimeoutMs: 20 }).code, 'TIMEOUT');
const cleanupTimeout = await boundedCleanup(new Promise(() => {}), {
  label: 'page teardown',
  timeoutMs: 5,
});
assert.equal(cleanupTimeout.status, 'timed-out');
assert.match(cleanupTimeout.error, /page teardown/);

console.log('Kimodo shared-device smoke adjudication contracts passed');
