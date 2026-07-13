import assert from 'node:assert/strict';

import {
  SCHEDULER_EVENT_TRACE_SCHEMA,
  SCHEDULER_VERIFICATION_RECEIPT_SCHEMA,
  classifySchedulerVerificationReceipt,
  createSchedulerVerificationReceipt,
  validateSchedulerVerificationReceipt,
} from '../src/index.js';

function createMogeStageReceipt(overrides = {}) {
  return createSchedulerVerificationReceipt({
    route: {
      pipelineId: 'moge-depth-normal-webgpu-local-v0',
      requestedRouteId: 'moge.depth-normal.webgpu-local.v0',
      effectiveRouteId: 'moge.depth-normal.webgpu-local.v0',
      backendClass: 'browser-webgpu',
    },
    scheduler: {
      schema: 'kaminos.webgpu-route-scheduler.v0',
      requestedScheduler: {
        mode: 'cooperative',
        phaseChunkSize: {
          backbone: 1,
          'decoder-heads': 1,
          'output-readback': 1,
        },
        waitForSubmittedWorkDone: true,
        yieldMs: 4,
      },
      effectiveScheduler: {
        mode: 'cooperative',
        phaseChunkSize: {
          backbone: 1,
          'decoder-heads': 1,
          'output-readback': 1,
        },
        waitForSubmittedWorkDone: true,
        yieldMs: 4,
        unsupportedFields: [],
      },
      verificationState: 'scheduler-unverified',
    },
    backpressure: {
      schema: 'kaminos.webgpu-route-backpressure.v0',
      requestedBudget: 'visible-wait',
      effectiveBudget: 'visible-wait',
    },
    eventTrace: {
      schema: SCHEDULER_EVENT_TRACE_SCHEMA,
      clock: 'performance.now',
      timingAuthority: 'queue-submit-wait',
      events: [
        { tMs: 1, phase: 'backbone', boundary: 'moge-stage:backbone', kind: 'queue-work-done-start' },
        { tMs: 2, phase: 'backbone', boundary: 'moge-stage:backbone', kind: 'queue-work-done-end', queueDoneMs: 1 },
        { tMs: 3, phase: 'decoder-heads', boundary: 'moge-stage:decoder-heads', kind: 'queue-work-done-start' },
        { tMs: 4, phase: 'decoder-heads', boundary: 'moge-stage:decoder-heads', kind: 'queue-work-done-end', queueDoneMs: 1 },
        { tMs: 5, phase: 'output-readback', boundary: 'moge-stage:output-readback', kind: 'queue-work-done-start' },
        { tMs: 6, phase: 'output-readback', boundary: 'moge-stage:output-readback', kind: 'queue-work-done-end', queueDoneMs: 1 },
      ],
    },
    boundaryAssertions: [
      {
        field: 'phaseChunkSize.backbone',
        requested: 1,
        effective: 1,
        status: 'observed',
        observedBoundary: 'moge-stage:backbone',
        observedCount: 1,
        expectedMinimumCount: 1,
      },
      {
        field: 'phaseChunkSize.decoder-heads',
        requested: 1,
        effective: 1,
        status: 'observed',
        observedBoundary: 'moge-stage:decoder-heads',
        observedCount: 1,
        expectedMinimumCount: 1,
      },
      {
        field: 'phaseChunkSize.output-readback',
        requested: 1,
        effective: 1,
        status: 'observed',
        observedBoundary: 'moge-stage:output-readback',
        observedCount: 1,
        expectedMinimumCount: 1,
      },
    ],
    ...overrides,
  });
}

const mogeStageReceipt = createMogeStageReceipt();
assert.equal(mogeStageReceipt.schema, SCHEDULER_VERIFICATION_RECEIPT_SCHEMA);
assert.equal(mogeStageReceipt.status, 'scheduler-unverified');
assert.equal(mogeStageReceipt.classification, 'config-only');
assert.equal(mogeStageReceipt.observationClass, 'observed-stage-boundary');
assert.deepEqual(mogeStageReceipt.downgrades, ['yield-events-missing']);
assert.equal(mogeStageReceipt.falseAuthorityChecks.requestedBoundaryAssertionMissing, false);
assert.equal(validateSchedulerVerificationReceipt(mogeStageReceipt).ok, true);

const classification = classifySchedulerVerificationReceipt(mogeStageReceipt);
assert.equal(classification.status, 'scheduler-unverified');
assert.equal(classification.classification, 'config-only');
assert.equal(classification.observationClass, 'observed-stage-boundary');
assert.deepEqual(classification.downgrades, ['yield-events-missing']);

const contradictoryVerifiedReceipt = createMogeStageReceipt({
  status: 'verified',
});
assert.equal(contradictoryVerifiedReceipt.status, 'scheduler-unverified');
assert.equal(contradictoryVerifiedReceipt.classification, 'config-only');
assert.ok(contradictoryVerifiedReceipt.downgrades.includes('yield-events-missing'));

const callerSuppliedGenericVerifiedReceipt = createMogeStageReceipt({
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: {
      mode: 'cooperative',
      phaseChunkSize: { backbone: 1 },
      waitForSubmittedWorkDone: true,
      yieldMs: 4,
    },
    effectiveScheduler: {
      mode: 'cooperative',
      phaseChunkSize: { backbone: 1 },
      waitForSubmittedWorkDone: true,
      yieldMs: 4,
      unsupportedFields: [],
    },
    verificationState: 'scheduler-unverified',
  },
  eventTrace: {
    schema: SCHEDULER_EVENT_TRACE_SCHEMA,
    clock: 'performance.now',
    timingAuthority: 'queue-submit-wait',
    events: [
      { tMs: 1, phase: 'backbone', boundary: 'moge-stage:backbone', kind: 'queue-work-done-start' },
      { tMs: 2, phase: 'backbone', boundary: 'moge-stage:backbone', kind: 'queue-work-done-end', queueDoneMs: 1 },
      { tMs: 3, phase: 'backbone', boundary: 'moge-stage:backbone', kind: 'js-yield-start' },
      { tMs: 7, phase: 'backbone', boundary: 'moge-stage:backbone', kind: 'js-yield-end', yieldMs: 4 },
    ],
  },
  boundaryAssertions: [
    {
      field: 'phaseChunkSize.backbone',
      requested: 1,
      effective: 1,
      status: 'verified',
      observedBoundary: 'moge-stage:backbone',
      observedCount: 1,
      expectedMinimumCount: 1,
    },
  ],
});
assert.equal(callerSuppliedGenericVerifiedReceipt.status, 'scheduler-unverified');
assert.equal(callerSuppliedGenericVerifiedReceipt.classification, 'config-only');
assert.equal(callerSuppliedGenericVerifiedReceipt.observationClass, 'observed-stage-boundary');
assert.equal(callerSuppliedGenericVerifiedReceipt.boundaryAssertions[0].status, 'observed');
assert.equal(callerSuppliedGenericVerifiedReceipt.boundaryAssertions[0].reportedStatus, 'verified');
assert.deepEqual(callerSuppliedGenericVerifiedReceipt.downgrades, []);
assert.equal(validateSchedulerVerificationReceipt(callerSuppliedGenericVerifiedReceipt).ok, true);

const unknownPhaseClaim = createMogeStageReceipt({
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: { mode: 'cooperative', phaseChunkSize: { speculativePhase: 4 } },
    effectiveScheduler: { mode: 'cooperative', phaseChunkSize: { speculativePhase: 4 }, unsupportedFields: [] },
    verificationState: 'verified',
  },
  eventTrace: {
    schema: SCHEDULER_EVENT_TRACE_SCHEMA,
    clock: 'performance.now',
    timingAuthority: 'queue-submit-wait',
    events: [{ tMs: 1, phase: 'speculativePhase', boundary: 'speculative-phase', kind: 'chunk-start' }],
  },
  boundaryAssertions: [{
    field: 'phaseChunkSize.speculativePhase',
    requested: 4,
    effective: 4,
    status: 'verified',
    observedBoundary: 'speculative-phase',
    observedCount: 1,
  }],
});
assert.equal(unknownPhaseClaim.status, 'scheduler-unverified', 'unknown phase claims must remain fail-closed');
assert.equal(unknownPhaseClaim.boundaryAssertions[0].status, 'observed');
assert.equal(unknownPhaseClaim.boundaryAssertions[0].reportedStatus, 'verified');

const missingEventsReceipt = createMogeStageReceipt({
  eventTrace: {
    schema: SCHEDULER_EVENT_TRACE_SCHEMA,
    clock: 'performance.now',
    timingAuthority: 'queue-submit-wait',
    events: [],
  },
});
assert.equal(missingEventsReceipt.status, 'scheduler-unverified');
assert.ok(missingEventsReceipt.downgrades.includes('event-trace-missing'));
assert.equal(missingEventsReceipt.falseAuthorityChecks.eventTraceMissing, true);
assert.equal(missingEventsReceipt.observationClass, 'config-only');

const unsupportedGenericPhase = createMogeStageReceipt({
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: {
      mode: 'cooperative',
      phaseChunkSize: { backbone: 1 },
      waitForSubmittedWorkDone: true,
    },
    effectiveScheduler: {
      mode: 'cooperative',
      phaseChunkSize: {},
      waitForSubmittedWorkDone: true,
      unsupportedFields: ['phaseChunkSize.backbone'],
    },
    verificationState: 'unsupported',
  },
  boundaryAssertions: [],
});
assert.equal(unsupportedGenericPhase.status, 'unsupported');
assert.equal(unsupportedGenericPhase.classification, 'unsupported');
assert.equal(validateSchedulerVerificationReceipt(unsupportedGenericPhase).ok, true);

const droppedGenericPhase = createMogeStageReceipt({
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: {
      mode: 'cooperative',
      phaseChunkSize: { backbone: 1 },
      waitForSubmittedWorkDone: true,
    },
    effectiveScheduler: {
      mode: 'cooperative',
      phaseChunkSize: {},
      waitForSubmittedWorkDone: true,
      unsupportedFields: [],
    },
    verificationState: 'scheduler-unverified',
  },
  boundaryAssertions: [],
});
assert.equal(droppedGenericPhase.status, 'invalid');
assert.ok(droppedGenericPhase.downgrades.includes('requested-field-dropped-without-unsupported'));
assert.equal(validateSchedulerVerificationReceipt(droppedGenericPhase).ok, false);

const missingRouteReceipt = createMogeStageReceipt({
  route: {},
});
assert.equal(missingRouteReceipt.status, 'invalid');
assert.ok(missingRouteReceipt.downgrades.includes('route-identity-missing'));
assert.equal(validateSchedulerVerificationReceipt(missingRouteReceipt).ok, false);

console.log('scheduler verification receipt contracts passed');
