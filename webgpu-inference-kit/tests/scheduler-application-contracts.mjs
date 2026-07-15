import assert from 'node:assert/strict';

import {
  FOREGROUND_BUDGET_GOVERNOR_SCHEMA,
  WEBGPU_SCHEDULER_APPLICATION_SCHEMA,
  WEBGPU_SCHEDULER_DECISION_APPLICATION_SCHEMA,
  WEBGPU_SCHEDULER_INVOCATION_SCHEMA,
  createWebGpuInferenceRuntime,
  createWebGpuSchedulerApplication,
} from '../src/index.js';

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
assert.equal(invocation.applicationAuthority, 'frozen-future-invocation-snapshot');
assert.throws(
  () => { invocation.scheduler.phaseChunkSize.spnFusionOutputItems = 1; },
  /read only|readonly|not extensible|Cannot assign/i,
  'the scheduler snapshot exposed to an invocation must be immutable',
);
assert.equal(guarded.snapshot().scheduler.phaseChunkSize.spnFusionOutputItems, 8);

assert.throws(
  () => guarded.applyDecision(decision()),
  /active invocation.*cannot apply/i,
  'an in-flight invocation must never observe a scheduler mutation',
);
assert.equal(guarded.snapshot().revision, 0);
guarded.endInvocation(invocation);
assert.equal(guarded.snapshot().activeInvocationCount, 0);
assert.throws(() => guarded.endInvocation(invocation), /already ended|unknown invocation/i);

const applied = guarded.applyDecision(decision());
assert.equal(applied.schema, WEBGPU_SCHEDULER_DECISION_APPLICATION_SCHEMA);
assert.equal(applied.status, 'applied');
assert.equal(applied.routeId, routeId);
assert.equal(applied.previousRevision, 0);
assert.equal(applied.effectiveRevision, 1);
assert.equal(applied.applicationAuthority, 'subsequent-invocations-only');
assert.deepEqual(applied.previousScheduler, baselineScheduler);
assert.equal(applied.effectiveScheduler.phaseChunkSize.spnFusionOutputItems, 4);
assert.equal(guarded.snapshot().revision, 1);

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

const runtimeApplication = application();
const yields = [];
let nowMs = 0;
const now = () => {
  nowMs += 1;
  return nowMs;
};
const submissions = [];
const queue = {
  submit(commandBuffers) {
    submissions.push(commandBuffers);
  },
};
const device = {
  queue,
  features: new Set(),
  limits: {},
  createShaderModule(descriptor) { return { descriptor }; },
  createBindGroupLayout(descriptor) { return { descriptor }; },
  createPipelineLayout(descriptor) { return { descriptor }; },
  createBindGroup(descriptor) { return { descriptor }; },
  createComputePipeline(descriptor) { return { descriptor }; },
  createCommandEncoder(descriptor) {
    return {
      beginComputePass() {
        return {
          setPipeline() {},
          setBindGroup() {},
          dispatchWorkgroups() {},
          end() {},
        };
      },
      finish() { return { descriptor }; },
    };
  },
};

const runtime = await createWebGpuInferenceRuntime({
  routeId,
  runtimeLabel: 'guarded-scheduler-runtime',
  device,
  queue,
  adapterName: 'Guarded Scheduler Adapter',
  browser: 'Node contract fake',
  kernel: { profile: 'guarded-scheduler-contract' },
  requiredStages: ['spn-fusion'],
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
    return {
      reason: metadata.reason,
      waitForSubmittedWorkDone: metadata.scheduler.waitForSubmittedWorkDone,
      requestedYieldMs: metadata.scheduler.yieldMs,
      elapsedMs: metadata.scheduler.yieldMs,
      metadata: metadata.metadata || {},
    };
  },
});

const program = runtime.defineProgram({
  name: 'sharp.guarded-scheduler-program',
  kernels: {
    spnFusion: {
      code: '@compute @workgroup_size(1) fn main() {}',
      entryPoint: 'main',
      bindings: [{ name: 'stub', resource: { buffer: {} }, type: 'storage' }],
    },
  },
  phases: [{
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
  }],
});

const firstRun = await runtime.runProgram(program, { invocationId: 'runtime-invocation-a' });
assert.equal(firstRun.schedulerInvocation.schedulerRevision, 0);
assert.equal(firstRun.schedulerInvocation.invocationId, 'runtime-invocation-a');
assert.equal(yields.at(-1).schedulerRevision, 0);
assert.equal(yields.at(-1).scheduler.yieldMs, 2);

runtime.applySchedulerDecision(decision());
const secondRun = await runtime.runProgram(program, { invocationId: 'runtime-invocation-b' });
assert.equal(secondRun.schedulerInvocation.schedulerRevision, 1);
assert.equal(secondRun.schedulerInvocation.scheduler.phaseChunkSize.spnFusionOutputItems, 4);
assert.equal(yields.at(-1).schedulerRevision, 1);
assert.equal(runtime.schedulerSnapshot().revision, 1);

const dutyReport = runtime.finishCommandDuties();
assert.deepEqual(
  dutyReport.submissions.map(row => row.descriptor.chunkControl.current),
  [8, 4],
  'command-duty descriptors must report the effective control for each frozen invocation',
);

let releaseInvocation;
const heldInvocation = runtime.runInvocation(
  { invocationId: 'runtime-held-invocation' },
  async context => {
    assert.equal(context.schedulerRevision, 1);
    await new Promise(resolve => { releaseInvocation = resolve; });
    return context.getControl('spnFusionOutputItems');
  },
);
await Promise.resolve();
assert.throws(
  () => runtime.applySchedulerDecision(decision({
    revision: 2,
    previousScheduler: runtime.schedulerSnapshot().scheduler,
    effectiveScheduler: {
      ...runtime.schedulerSnapshot().scheduler,
      yieldMs: 4,
    },
    action: 'increase-yield-budget',
    target: 'yieldMs',
  })),
  /active invocation.*cannot apply/i,
);
releaseInvocation();
assert.equal(await heldInvocation, 4);

console.log('scheduler application contracts passed');
