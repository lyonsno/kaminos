import assert from 'node:assert/strict';

import {
  FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
  WEBGPU_BUFFER_USAGE,
  WEBGPU_SCHEDULER_APPLICATION_SCHEMA,
  WEBGPU_SCHEDULER_DECISION_APPLICATION_SCHEMA,
  WEBGPU_SCHEDULER_INVOCATION_SCHEMA,
  createWebGpuInferenceRuntime,
  createWebGpuSchedulerApplication,
} from '../src/index.js';

const WEBGPU_SCHEDULER_BOUNDARY_SCHEMA = 'kaminos.webgpu-scheduler-boundary.v0';

const routeId = 'sharp.image-to-splat.webgpu-local.v0';
const baselineScheduler = {
  mode: 'cooperative',
  yieldMs: 2,
  waitForSubmittedWorkDone: false,
  phaseChunkSize: {
    spnFusionOutputItems: 8,
    gaussianCpuItems: 16_384,
  },
};
const declaredBounds = {
  yieldMs: { min: 0, max: 20, step: 2 },
  phaseChunkSize: {
    spnFusionOutputItems: { min: 1, max: 8, stepFactor: 2 },
    gaussianCpuItems: { min: 4_096, max: 16_384, stepFactor: 2 },
  },
};

function decision({
  decisionRouteId = routeId,
  revision = 1,
  previousScheduler = baselineScheduler,
  effectiveScheduler = {
    ...baselineScheduler,
    phaseChunkSize: {
      ...baselineScheduler.phaseChunkSize,
      spnFusionOutputItems: 4,
    },
  },
  action = 'reduce-phase-chunk',
  target = 'spnFusionOutputItems',
  schedulerChanged = true,
  status = 'adjusted',
  failures = [],
  applicationAuthority = 'decision-state-only-not-runtime-application',
} = {}) {
  return {
    schema: FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
    routeId: decisionRouteId,
    status,
    action,
    target,
    schedulerChanged,
    applicationAuthority,
    revision,
    observation: {
      episodeId: `episode-${revision}`,
      episodeEpochId: 'sharp-governor-epoch-a',
      firingId: `firing-${revision}`,
      maxFrameGapMs: 88,
      targetFrameGapMs: 50,
    },
    previousScheduler: structuredClone(previousScheduler),
    effectiveScheduler: structuredClone(effectiveScheduler),
    failures,
  };
}

function application() {
  return createWebGpuSchedulerApplication({
    routeId,
    revision: 0,
    scheduler: structuredClone(baselineScheduler),
    bounds: structuredClone(declaredBounds),
  });
}

assert.throws(
  () => createWebGpuSchedulerApplication({
    routeId,
    scheduler: structuredClone(baselineScheduler),
    bounds: structuredClone(declaredBounds),
    maxBoundaries: 1,
  }),
  /boundary retention is uncapped/i,
  'live boundary history must not silently discard long-running inference duties',
);

const guarded = application();
const initial = guarded.snapshot();
assert.equal(initial.schema, WEBGPU_SCHEDULER_APPLICATION_SCHEMA);
assert.equal(initial.routeId, routeId);
assert.equal(initial.revision, 0);
assert.equal(initial.activeInvocationCount, 0);
assert.deepEqual(initial.scheduler, baselineScheduler);
assert.deepEqual(initial.bounds, declaredBounds);

const invocation = guarded.beginInvocation({ invocationId: 'sharp-invocation-a' });
assert.equal(invocation.schema, WEBGPU_SCHEDULER_INVOCATION_SCHEMA);
assert.equal(invocation.routeId, routeId);
assert.equal(invocation.invocationId, 'sharp-invocation-a');
assert.equal(invocation.schedulerRevision, 0);
assert.deepEqual(invocation.scheduler, baselineScheduler);
assert.equal(invocation.applicationAuthority, 'explicit-safe-boundary-refresh-no-submitted-work-preemption');
assert.throws(
  () => { invocation.scheduler.phaseChunkSize.spnFusionOutputItems = 1; },
  /read only|readonly|not extensible|Cannot assign/i,
  'the scheduler snapshot exposed to an invocation must be immutable',
);
assert.throws(
  () => { invocation.invocationId = 'mutated-invocation-id'; },
  /read only|readonly|not extensible|Cannot assign/i,
  'invocation identity must be immutable so cleanup cannot strand the original active id',
);
assert.throws(
  () => { invocation.schedulerRevision = 999; },
  /read only|readonly|not extensible|Cannot assign|only a getter/i,
  'the public invocation token must not lie about its effective scheduler revision',
);
assert.equal(guarded.snapshot().scheduler.phaseChunkSize.spnFusionOutputItems, 8);

const applied = guarded.applyDecision(decision());
assert.equal(applied.schema, WEBGPU_SCHEDULER_DECISION_APPLICATION_SCHEMA);
assert.equal(applied.status, 'applied');
assert.equal(applied.routeId, routeId);
assert.equal(applied.previousRevision, 0);
assert.equal(applied.effectiveRevision, 1);
assert.equal(applied.applicationAuthority, 'future-invocations-and-explicit-active-boundaries');
assert.deepEqual(applied.previousScheduler, baselineScheduler);
assert.equal(applied.effectiveScheduler.phaseChunkSize.spnFusionOutputItems, 4);
assert.equal(guarded.snapshot().revision, 1);
assert.equal(invocation.schedulerRevision, 0, 'application changes do not mutate active work mid-duty');

const liveBoundary = invocation.refreshAtBoundary({
  boundaryId: 'sharp-invocation-a:before-duty-1',
  dutyId: 'sharp-invocation-a:duty-1',
  phase: 'spn-fusion',
  position: 'before-encode',
});
assert.equal(liveBoundary.schema, WEBGPU_SCHEDULER_BOUNDARY_SCHEMA);
assert.equal(liveBoundary.status, 'updated');
assert.equal(liveBoundary.routeId, routeId);
assert.equal(liveBoundary.invocationId, 'sharp-invocation-a');
assert.equal(liveBoundary.dutyId, 'sharp-invocation-a:duty-1');
assert.equal(liveBoundary.previousSchedulerRevision, 0);
assert.equal(liveBoundary.observedApplicationRevision, 1);
assert.equal(liveBoundary.effectiveSchedulerRevision, 1);
assert.equal(liveBoundary.schedulerChanged, true);
assert.equal(liveBoundary.scheduler.phaseChunkSize.spnFusionOutputItems, 4);
assert.equal(liveBoundary.requestedYieldMs, 2);
assert.equal(liveBoundary.effectiveYieldMs, 2);
assert.equal(liveBoundary.effectivePhaseChunkSize.spnFusionOutputItems, 4);
assert.equal(liveBoundary.applicationAuthority, 'pre-encoding-safe-boundary-no-submission-claim-no-submitted-work-preemption');
assert.equal(invocation.schedulerRevision, 1);
assert.equal(invocation.getControl('spnFusionOutputItems'), 4);
assert.throws(
  () => invocation.refreshAtBoundary({
    boundaryId: 'sharp-invocation-a:before-duty-1',
    dutyId: 'sharp-invocation-a:duty-1',
    phase: 'spn-fusion',
    position: 'before-encode',
  }),
  /duplicate scheduler boundary/i,
);
const endedLiveInvocation = guarded.endInvocation(invocation);
assert.equal(endedLiveInvocation.effectiveSchedulerRevision, 1);
assert.equal(endedLiveInvocation.boundaryCount, 1);
assert.equal(guarded.snapshot().activeInvocationCount, 0);
assert.throws(() => guarded.endInvocation(invocation), /already ended|unknown invocation/i);
assert.throws(
  () => invocation.refreshAtBoundary({
    boundaryId: 'sharp-invocation-a:after-end',
    dutyId: 'sharp-invocation-a:duty-after-end',
    phase: 'spn-fusion',
    position: 'before-encode',
  }),
  /invocation.*ended|unknown invocation/i,
);
const reusedInvocationId = guarded.beginInvocation({ invocationId: 'sharp-invocation-a' });
guarded.endInvocation(reusedInvocationId);

const nextInvocation = guarded.beginInvocation({ invocationId: 'sharp-invocation-b' });
assert.equal(nextInvocation.schedulerRevision, 1);
assert.equal(nextInvocation.scheduler.phaseChunkSize.spnFusionOutputItems, 4);
assert.equal(nextInvocation.getControl('spnFusionOutputItems'), 4);
assert.throws(() => nextInvocation.getControl('undeclaredControl'), /undeclared scheduler control/i);
guarded.endInvocation(nextInvocation);

assert.throws(() => guarded.applyDecision(decision()), /replayed|stale revision/i);
assert.throws(() => application().applyDecision(decision({ revision: 2 })), /next revision/i);
assert.throws(
  () => application().applyDecision(decision({ decisionRouteId: 'other.route.webgpu-local.v0' })),
  /route.*mismatch/i,
);
assert.throws(
  () => application().applyDecision(decision({
    previousScheduler: { ...baselineScheduler, yieldMs: 4 },
  })),
  /previous scheduler.*mismatch/i,
);
assert.throws(
  () => application().applyDecision(decision({
    effectiveScheduler: {
      ...baselineScheduler,
      phaseChunkSize: { ...baselineScheduler.phaseChunkSize, spnFusionOutputItems: 16 },
    },
  })),
  /outside.*declared bounds/i,
);
assert.throws(
  () => application().applyDecision(decision({
    effectiveScheduler: {
      ...baselineScheduler,
      phaseChunkSize: { ...baselineScheduler.phaseChunkSize, hiddenCap: 1 },
    },
  })),
  /undeclared scheduler control/i,
);
assert.throws(
  () => application().applyDecision(decision({ schedulerChanged: false, status: 'maintaining' })),
  /does not authorize a scheduler change/i,
);
assert.throws(
  () => application().applyDecision(decision({ failures: ['stale-evidence'] })),
  /failures.*cannot be applied/i,
);
assert.throws(
  () => application().applyDecision(decision({ applicationAuthority: 'runtime-preemption-authorized' })),
  /application authority/i,
);

const foreign = application();
const foreignInvocation = foreign.beginInvocation({ invocationId: 'foreign-invocation' });
assert.throws(() => guarded.endInvocation(foreignInvocation), /unknown invocation/i);
foreign.endInvocation(foreignInvocation);

const parallel = application();
const parallelA = parallel.beginInvocation({ invocationId: 'parallel-a' });
const parallelB = parallel.beginInvocation({ invocationId: 'parallel-b' });
parallel.applyDecision(decision());
const parallelABoundary = parallelA.refreshAtBoundary({
  boundaryId: 'parallel-a:boundary-1',
  dutyId: 'parallel-a:duty-1',
  phase: 'spn-fusion',
  position: 'before-encode',
});
assert.equal(parallelABoundary.effectiveSchedulerRevision, 1);
assert.equal(parallelB.schedulerRevision, 0, 'one active invocation refresh must not mutate its sibling');
parallel.endInvocation(parallelA);
const parallelRevisionOne = parallel.snapshot().scheduler;
parallel.applyDecision(decision({
  revision: 2,
  previousScheduler: parallelRevisionOne,
  effectiveScheduler: { ...parallelRevisionOne, yieldMs: 4 },
  action: 'increase-yield-budget',
  target: 'yieldMs',
}));
const parallelBBoundary = parallelB.refreshAtBoundary({
  boundaryId: 'parallel-b:boundary-1',
  dutyId: 'parallel-b:duty-1',
  phase: 'gaussian-cpu',
  position: 'before-encode',
});
assert.equal(parallelBBoundary.previousSchedulerRevision, 0);
assert.equal(parallelBBoundary.effectiveSchedulerRevision, 2);
assert.equal(parallelBBoundary.effectiveYieldMs, 4);
parallel.endInvocation(parallelB);
assert.deepEqual(
  parallel.snapshot().boundaries.map(row => [row.invocationId, row.effectiveSchedulerRevision]),
  [['parallel-a', 1], ['parallel-b', 2]],
  'each active invocation must advance only when it reaches its own explicit safe boundary',
);

const runtimeApplication = application();
const yields = [];
let nowMs = 0;
const now = () => {
  nowMs += 1;
  return nowMs;
};
const submissions = [];
const encodedDispatches = [];
const queue = {
  submit(commandBuffers) {
    for (const commandBuffer of commandBuffers) {
      for (const copy of commandBuffer.copies || []) {
        copy.destination.data.set(
          copy.source.data.subarray(copy.sourceOffset, copy.sourceOffset + copy.size),
          copy.destinationOffset,
        );
      }
    }
    submissions.push(commandBuffers);
  },
};
const device = {
  queue,
  features: new Set(),
  limits: {},
  createBuffer(descriptor) {
    const buffer = {
      descriptor,
      data: new Uint8Array(descriptor.size),
      async mapAsync() {},
      getMappedRange(offset = 0, size = descriptor.size - offset) {
        return buffer.data.slice(offset, offset + size).buffer;
      },
      unmap() {},
    };
    return buffer;
  },
  createShaderModule(descriptor) { return { descriptor }; },
  createBindGroupLayout(descriptor) { return { descriptor }; },
  createPipelineLayout(descriptor) { return { descriptor }; },
  createBindGroup(descriptor) { return { descriptor }; },
  createComputePipeline(descriptor) { return { descriptor }; },
  createCommandEncoder(descriptor) {
    const copies = [];
    return {
      copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
        copies.push({ source, sourceOffset, destination, destinationOffset, size });
      },
      beginComputePass() {
        return {
          setPipeline() {},
          setBindGroup() {},
          dispatchWorkgroups(...dispatch) { encodedDispatches.push(dispatch); },
          end() {},
        };
      },
      finish() { return { descriptor, copies }; },
    };
  },
};

let runtime;
let liveDecisionApplied = false;
runtime = await createWebGpuInferenceRuntime({
  routeId,
  runtimeLabel: 'guarded-scheduler-runtime',
  device,
  queue,
  adapterName: 'Guarded Scheduler Adapter',
  browser: 'Node contract fake',
  kernel: { profile: 'guarded-scheduler-contract' },
  requiredStages: ['spn-fusion', 'readback-output'],
  schedulerApplication: runtimeApplication,
  commandDuties: {
    runId: 'sharp-runtime-application-run-a',
    clock: {
      clockId: 'sharp-runtime-application-clock-a',
      source: 'performance.now',
      timeOriginEpochMs: 1_700_000_000_000,
    },
  },
  now,
  yield: async metadata => {
    yields.push(structuredClone(metadata));
    if (!liveDecisionApplied && metadata.schedulerRevision === 0) {
      liveDecisionApplied = true;
      runtime.applySchedulerDecision(decision());
    }
    return {
      reason: metadata.reason,
      waitForSubmittedWorkDone: metadata.scheduler.waitForSubmittedWorkDone,
      requestedYieldMs: metadata.scheduler.yieldMs,
      elapsedMs: metadata.scheduler.yieldMs,
      metadata: metadata.metadata || {},
    };
  },
});

const readbackOutput = runtime.createTensor({
  name: 'sharp.guarded-scheduler-output',
  shape: [1],
  dtype: 'f32',
  usage: WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copySrc,
});
new Float32Array(readbackOutput.buffer.data.buffer).set([0.75]);

await runtime.runInvocation({ invocationId: 'invalid-boundary-invocation' }, async context => {
  const boundaryCount = runtime.schedulerSnapshot().boundaryCount;
  assert.throws(
    () => runtime.prepareCommandDuty({
      phase: 'invalid-bounds',
      kind: 'compute',
      chunkControl: {
        controlId: 'spnFusionOutputItems',
        unit: 'output-item',
        current: 8,
        bounds: { ...declaredBounds.phaseChunkSize.spnFusionOutputItems, min: 2 },
      },
    }, context),
    /duty bounds mismatch/i,
  );
  assert.equal(
    runtime.schedulerSnapshot().boundaryCount,
    boundaryCount,
    'invalid pre-submit controls must fail before a boundary receipt can claim scheduler uptake',
  );
});

const program = runtime.defineProgram({
  name: 'sharp.guarded-scheduler-program',
  tensors: { readbackOutput },
  kernels: {
    spnFusion: {
      code: '@compute @workgroup_size(1) fn main() {}',
      entryPoint: 'main',
      bindings: [{ name: 'stub', resource: { buffer: {} }, type: 'storage' }],
    },
  },
  phases: [
    {
      name: 'spn-fusion',
      kernel: 'spnFusion',
      dispatch: [1],
      yieldAfter: true,
      commandDuty: {
        chunkControl: {
          controlId: 'spnFusionOutputItems',
          unit: 'output-item',
          current: 8,
          bounds: declaredBounds.phaseChunkSize.spnFusionOutputItems,
        },
      },
    },
    {
      name: 'readback-output',
      readbacks: [{
        name: 'outputBytes',
        tensor: 'readbackOutput',
        options: {
          commandDuty: {
            chunkControl: {
              controlId: 'spnFusionOutputItems',
              unit: 'output-item',
              current: 8,
              bounds: declaredBounds.phaseChunkSize.spnFusionOutputItems,
            },
          },
        },
      }],
    },
  ],
});

const firstRun = await runtime.runProgram(program, { invocationId: 'runtime-invocation-a' });
assert.equal(firstRun.schedulerInvocation.schedulerRevision, 1);
assert.equal(firstRun.schedulerInvocation.invocationId, 'runtime-invocation-a');
assert.equal(new Float32Array(firstRun.outputs.outputBytes)[0], 0.75);
assert.equal(yields.at(-1).schedulerRevision, 0);
assert.equal(yields.at(-1).scheduler.yieldMs, 2);
const firstRunBoundaries = runtime.schedulerSnapshot().boundaries
  .filter(row => row.invocationId === 'runtime-invocation-a');
assert.equal(firstRunBoundaries.length, 2);
assert.deepEqual(
  firstRunBoundaries.map(row => ({
    phase: row.phase,
    previous: row.previousSchedulerRevision,
    effective: row.effectiveSchedulerRevision,
    changed: row.schedulerChanged,
  })),
  [
    { phase: 'spn-fusion', previous: 0, effective: 0, changed: false },
    { phase: 'readback-output', previous: 0, effective: 1, changed: true },
  ],
);

const secondRun = await runtime.runProgram(program, { invocationId: 'runtime-invocation-b' });
assert.equal(secondRun.schedulerInvocation.schedulerRevision, 1);
assert.equal(secondRun.schedulerInvocation.scheduler.phaseChunkSize.spnFusionOutputItems, 4);
assert.equal(yields.at(-1).schedulerRevision, 1);
assert.equal(runtime.schedulerSnapshot().revision, 1);

await runtime.runInvocation({ invocationId: 'runtime-dynamic-dispatch' }, async context => {
  await runtime.runKernel(program.phases[0].kernel, {
    stage: 'dynamic-spn-fusion',
    schedulerInvocation: context,
    commandDuty: program.phases[0].commandDuty,
    dispatch({ commandDuty }) {
      assert.equal(commandDuty.metadata.schedulerBoundary.effectiveSchedulerRevision, 1);
      assert.equal(commandDuty.chunkControl.current, 4);
      return [commandDuty.chunkControl.current];
    },
  });
});
assert.deepEqual(
  encodedDispatches.at(-1),
  [4, 1, 1],
  'a custom adapter can derive the work it encodes from the control refreshed at the same duty boundary',
);

const dutyReport = runtime.finishCommandDuties();
assert.deepEqual(
  dutyReport.submissions.map(row => row.descriptor.chunkControl.current),
  [8, 4, 4, 4, 4],
  'each compute and staged-readback duty must report the scheduler revision effective at its own safe boundary',
);
assert.deepEqual(
  dutyReport.submissions.map(row => ({
    revision: row.descriptor.metadata.schedulerBoundary.effectiveSchedulerRevision,
    yieldMs: row.descriptor.metadata.schedulerBoundary.effectiveYieldMs,
    dutyId: row.descriptor.metadata.schedulerBoundary.dutyId,
  })),
  dutyReport.submissions.map((row, index) => ({
    revision: [0, 1, 1, 1, 1][index],
    yieldMs: 2,
    dutyId: row.descriptor.dutyId,
  })),
  'every recorded duty must carry the exact boundary revision and effective donation delay it consumed',
);

let releaseInvocation;
const heldInvocation = runtime.runInvocation(
  { invocationId: 'runtime-held-invocation' },
  async context => {
    assert.equal(context.schedulerRevision, 1);
    await new Promise(resolve => { releaseInvocation = resolve; });
    const boundary = context.refreshAtBoundary({
      boundaryId: 'runtime-held-invocation:before-duty',
      dutyId: 'runtime-held-invocation:duty',
      phase: 'held-phase',
      position: 'before-encode',
    });
    return {
      revision: boundary.effectiveSchedulerRevision,
      yieldMs: boundary.scheduler.yieldMs,
      control: context.getControl('spnFusionOutputItems'),
    };
  },
);
await Promise.resolve();
const revisionOneScheduler = runtime.schedulerSnapshot().scheduler;
const heldApplication = runtime.applySchedulerDecision(decision({
  revision: 2,
  previousScheduler: revisionOneScheduler,
  effectiveScheduler: {
    ...revisionOneScheduler,
    yieldMs: 4,
  },
  action: 'increase-yield-budget',
  target: 'yieldMs',
}));
assert.equal(heldApplication.effectiveRevision, 2);
releaseInvocation();
assert.deepEqual(await heldInvocation, { revision: 2, yieldMs: 4, control: 4 });

let releaseQueuedJob;
let signalQueuedJobStarted;
const queuedJobStarted = new Promise(resolve => { signalQueuedJobStarted = resolve; });
const adaptiveQueue = runtime.createInferenceQueue({ now });
const queuedA = adaptiveQueue.enqueue({
  jobId: 'adaptive-queue-job-a',
  async execute(context) {
    signalQueuedJobStarted();
    await new Promise(resolve => { releaseQueuedJob = resolve; });
    return { revision: context.schedulerRevision, yieldMs: context.scheduler.yieldMs };
  },
});
const queuedB = adaptiveQueue.enqueue({
  jobId: 'adaptive-queue-job-b',
  async execute(context) {
    return { revision: context.schedulerRevision, yieldMs: context.scheduler.yieldMs };
  },
});
await queuedJobStarted;
const revisionTwoScheduler = runtime.schedulerSnapshot().scheduler;
const queuedDecision = adaptiveQueue.scheduleSchedulerDecision(decision({
  revision: 3,
  previousScheduler: revisionTwoScheduler,
  effectiveScheduler: {
    ...revisionTwoScheduler,
    yieldMs: 6,
  },
  action: 'increase-yield-budget',
  target: 'yieldMs',
}));
releaseQueuedJob();
assert.deepEqual((await queuedA.completion).output, { revision: 2, yieldMs: 4 });
assert.equal((await queuedDecision).application.effectiveRevision, 3);
assert.deepEqual((await queuedB.completion).output, { revision: 3, yieldMs: 6 });
assert.equal((await adaptiveQueue.drain()).status, 'idle');

console.log('scheduler application contracts passed');
