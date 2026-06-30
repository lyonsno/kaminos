import assert from 'node:assert/strict';

import {
  BACKEND_EXECUTOR_KINDS,
  createRouteJob,
  createRouteRunReceipt,
  normalizeRouteJobStatus,
} from '../route-runtime.mjs';

function testExecutorKindsIncludeNativeAndBrowserRoutes() {
  assert.ok(BACKEND_EXECUTOR_KINDS.includes('webgpu-local'));
  assert.ok(BACKEND_EXECUTOR_KINDS.includes('browser-webgpu'));
  assert.ok(BACKEND_EXECUTOR_KINDS.includes('native-greenroom'));
  assert.ok(BACKEND_EXECUTOR_KINDS.includes('local-command'));
  assert.ok(BACKEND_EXECUTOR_KINDS.includes('http-job'));
  assert.ok(BACKEND_EXECUTOR_KINDS.includes('websocket-job'));
  assert.ok(BACKEND_EXECUTOR_KINDS.includes('comfyui-workflow'));
  assert.ok(BACKEND_EXECUTOR_KINDS.includes('fixture'));
}

function testRouteJobRequiresPortableExecutorIdentity() {
  const job = createRouteJob({
    id: 'job-greenroom-1',
    routeId: 'trellis2mlx.hero-checkpoint',
    executor: {
      kind: 'native-greenroom',
      id: 'local-greenroom',
      nativeQueueDir: '/Users/noahlyons/.local/state/gpu-greenroom',
    },
    priorityClass: 'hero',
    inputArtifacts: [{ role: 'source-image', path: '/tmp/source.png', sha256: 'abc' }],
    outputPolicy: { root: '/tmp/out', mode: 'caller-owned' },
  });

  assert.equal(job.schema, 'kaminos.route-job.v0');
  assert.equal(job.executor.kind, 'native-greenroom');
  assert.equal(job.priorityClass, 'hero');
  assert.equal(job.status, 'pending');
  assert.equal(job.resumability.kind, 'unknown');
  assert.equal(job.inputArtifacts[0].role, 'source-image');
}

function testRouteJobRejectsUnknownExecutorKind() {
  assert.throws(
    () => createRouteJob({
      id: 'bad',
      routeId: 'bad.route',
      executor: { kind: 'greenroom-is-not-universal' },
    }),
    /unknown executor kind/,
  );
}

function testWebGpuRouteJobCanDeclareCooperativeYieldPolicy() {
  const job = createRouteJob({
    id: 'job-webgpu-moge',
    routeId: 'moge.depth-normal.webgpu-local.v0',
    executor: {
      kind: 'browser-webgpu',
      id: 'browser-worker',
      backendKind: 'webgpu-local',
      workerModule: './routes/moge-worker.js',
    },
    intent: 'preview',
    priorityClass: 'preview',
    capabilities: {
      deferable: true,
      abortable: true,
      chunkYieldable: true,
      checkpointable: false,
      resumable: false,
      warmCacheSensitive: true,
      memoryExclusive: true,
    },
    controls: [{
      kind: 'defer-before-start',
      label: 'Defer',
      enabled: true,
    }],
    resumability: {
      kind: 'cooperative-yield',
      boundaries: ['stage', 'dispatch-batch'],
      memoryPolicy: 'yield-keep-warm',
    },
  });

  assert.equal(job.executor.kind, 'browser-webgpu');
  assert.equal(job.executor.backendKind, 'webgpu-local');
  assert.equal(job.intent, 'preview');
  assert.equal(job.capabilities.chunkYieldable, true);
  assert.equal(job.capabilities.warmCacheSensitive, true);
  assert.equal(job.controls[0].kind, 'defer-before-start');
  assert.equal(job.resumability.kind, 'cooperative-yield');
  assert.deepEqual(job.resumability.boundaries, ['stage', 'dispatch-batch']);
  assert.equal(job.resumability.memoryPolicy, 'yield-keep-warm');
}

function testRouteJobRejectsUnknownIntent() {
  assert.throws(
    () => createRouteJob({
      id: 'bad-intent',
      routeId: 'bad.route',
      executor: { kind: 'fixture' },
      intent: 'mystery-meat',
    }),
    /unknown route intent/,
  );
}

function testReceiptRecordsRequestedAndEffectiveExecutorIdentity() {
  const job = createRouteJob({
    id: 'job-1',
    routeId: 'trellis2mlx.resume-standard',
    executor: { kind: 'native-greenroom', id: 'local-greenroom' },
  });
  const receipt = createRouteRunReceipt({
    job,
    status: 'done',
    effectiveExecutor: {
      kind: 'native-greenroom',
      id: 'local-greenroom',
      greenroomJobId: 'abc123',
      effectiveCwd: '/Users/noahlyons/dev/trellis2mlx',
    },
    artifacts: [{ role: 'mesh', path: '/tmp/output.glb', bytes: 1024, sha256: 'def' }],
    timings: { startedAt: 1, finishedAt: 3 },
  });

  assert.equal(receipt.schema, 'kaminos.route-run.v0');
  assert.equal(receipt.requestedExecutor.kind, 'native-greenroom');
  assert.equal(receipt.intent, 'unknown');
  assert.equal(receipt.effectiveExecutor.greenroomJobId, 'abc123');
  assert.equal(receipt.artifacts[0].role, 'mesh');
  assert.equal(receipt.timings.durationSeconds, 2);
}

function testStatusNormalizerPreservesDegradedEvidence() {
  assert.equal(normalizeRouteJobStatus('done'), 'done');
  assert.equal(normalizeRouteJobStatus('checkpoint_paused'), 'checkpoint_paused');
  assert.equal(normalizeRouteJobStatus('paused_at_checkpoint'), 'paused_at_checkpoint');
  assert.equal(normalizeRouteJobStatus('legacy-camelcase-row'), 'degraded');
}

testExecutorKindsIncludeNativeAndBrowserRoutes();
testRouteJobRequiresPortableExecutorIdentity();
testRouteJobRejectsUnknownExecutorKind();
testWebGpuRouteJobCanDeclareCooperativeYieldPolicy();
testRouteJobRejectsUnknownIntent();
testReceiptRecordsRequestedAndEffectiveExecutorIdentity();
testStatusNormalizerPreservesDegradedEvidence();

console.log('route-runtime contracts passed');
