import assert from 'node:assert/strict';

import {
  WEBGPU_ROUTE_BACKPRESSURE_SCHEMA,
  WEBGPU_ROUTE_SCHEDULER_SCHEMA,
  createWebGpuRouteBackpressureProfile,
  createWebGpuRouteSchedulerProfile,
  validateWebGpuRouteBackpressureProfile,
  validateWebGpuRouteSchedulerProfile,
} from '../src/index.js';

const scheduler = createWebGpuRouteSchedulerProfile({
  requestedScheduler: {
    mode: 'cooperative',
    yieldMs: 5,
    waitForSubmittedWorkDone: true,
    phaseChunkSize: {
      spnPatch: 1,
      vitBlock: 4,
    },
  },
  effectiveScheduler: {
    mode: 'cooperative',
    yieldMs: 5,
    waitForSubmittedWorkDone: true,
    phaseChunkSize: {
      spnPatch: 1,
    },
    unsupportedFields: ['phaseChunkSize.vitBlock'],
  },
  verificationState: 'scheduler-unverified',
  breathability: {
    spans: [
      {
        name: 'vit-block-submit',
        stage: 'vitBlock',
        kind: 'gpu-submit-bound',
        interruptible: false,
        canYieldBefore: true,
        canYieldAfter: true,
        nonInterruptibleReason: 'GPU command buffers cannot be preempted after submit',
      },
      {
        name: 'readback',
        stage: 'output-readback',
        kind: 'readback-bound',
        interruptible: false,
        canYieldBefore: true,
        canYieldAfter: true,
      },
    ],
    checkpoints: [
      {
        name: 'between-vit-blocks',
        kind: 'stage-boundary',
        afterStage: 'vitBlock',
        yieldable: true,
        waitsForSubmittedWorkDone: true,
      },
    ],
  },
});

assert.equal(WEBGPU_ROUTE_SCHEDULER_SCHEMA, 'kaminos.webgpu-route-scheduler.v0');
assert.equal(scheduler.schema, WEBGPU_ROUTE_SCHEDULER_SCHEMA);
assert.equal(scheduler.requestedScheduler.mode, 'cooperative');
assert.equal(scheduler.effectiveScheduler.mode, 'cooperative');
assert.deepEqual(scheduler.effectiveScheduler.unsupportedFields, ['phaseChunkSize.vitBlock']);
assert.equal(scheduler.verificationState, 'scheduler-unverified');
assert.equal(scheduler.breathability.spans[0].kind, 'gpu-submit-bound');
assert.equal(scheduler.breathability.spans[0].interruptible, false);
assert.equal(scheduler.breathability.checkpoints[0].yieldable, true);
assert.deepEqual(validateWebGpuRouteSchedulerProfile(scheduler), { ok: true, errors: [] });

const requestedPhaseChunks = { gaussianPhase: 1 };
const isolatedScheduler = createWebGpuRouteSchedulerProfile({
  requestedScheduler: {
    mode: 'cooperative',
    phaseChunkSize: requestedPhaseChunks,
  },
});
requestedPhaseChunks.gaussianPhase = 99;
assert.deepEqual(isolatedScheduler.requestedScheduler.phaseChunkSize, { gaussianPhase: 1 });

const invalidCooperative = validateWebGpuRouteSchedulerProfile({
  ...scheduler,
  effectiveScheduler: {
    ...scheduler.effectiveScheduler,
    unsupportedFields: [],
  },
  verificationState: 'verified',
});
assert.equal(invalidCooperative.ok, false);
assert.match(
  invalidCooperative.errors.join('\n'),
  /verified scheduler cannot drop requested phaseChunkSize.vitBlock/,
);

const invalidMode = validateWebGpuRouteSchedulerProfile({
  ...scheduler,
  requestedScheduler: {
    ...scheduler.requestedScheduler,
    mode: 'magic-priority-queue',
  },
});
assert.equal(invalidMode.ok, false);
assert.match(invalidMode.errors.join('\n'), /requestedScheduler.mode/);

const invalidGpuPreemptionClaim = validateWebGpuRouteSchedulerProfile({
  ...scheduler,
  breathability: {
    ...scheduler.breathability,
    spans: [
      {
        ...scheduler.breathability.spans[0],
        interruptible: true,
      },
    ],
  },
});
assert.equal(invalidGpuPreemptionClaim.ok, false);
assert.match(invalidGpuPreemptionClaim.errors.join('\n'), /gpu-submit-bound.*interruptible/);

const backpressure = createWebGpuRouteBackpressureProfile({
  requestedBudget: 'visible-wait',
  effectiveBudget: 'furnace',
  memoryExclusivity: 'shared',
  warmCacheState: 'warm',
  frameTail: {
    sampleWindowMs: 30000,
    longFrameCount: 8,
    maxFrameGapMs: 188.4,
    p95FrameGapMs: 48.1,
    p99FrameGapMs: 144.2,
  },
});

assert.equal(WEBGPU_ROUTE_BACKPRESSURE_SCHEMA, 'kaminos.webgpu-route-backpressure.v0');
assert.equal(backpressure.schema, WEBGPU_ROUTE_BACKPRESSURE_SCHEMA);
assert.equal(backpressure.requestedBudget, 'visible-wait');
assert.equal(backpressure.effectiveBudget, 'furnace');
assert.equal(backpressure.frameTail.longFrameCount, 8);
assert.deepEqual(validateWebGpuRouteBackpressureProfile(backpressure), { ok: true, errors: [] });

const invalidBackpressure = validateWebGpuRouteBackpressureProfile({
  ...backpressure,
  frameTail: {
    ...backpressure.frameTail,
    longFrameCount: -1,
  },
});
assert.equal(invalidBackpressure.ok, false);
assert.match(invalidBackpressure.errors.join('\n'), /longFrameCount/);

console.log('scheduler backpressure contracts passed');
