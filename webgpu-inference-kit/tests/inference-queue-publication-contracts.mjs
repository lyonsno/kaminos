import assert from 'node:assert/strict';

const kit = await import('../src/index.js');

assert.equal(
  typeof kit.createWebGpuInferenceQueuePublication,
  'function',
  'the kit must expose a transport-neutral queue publication controller',
);

let tick = 0;
const routeId = 'sharp.image-to-splat.webgpu-local.v0';
const runtime = {
  routeId,
  async runInvocation({ invocationId }, execute) {
    return execute(Object.freeze({
      routeId,
      invocationId,
      schedulerRevision: 3,
      getControl() { return 1; },
      async yieldToBrowser() {},
    }));
  },
};
const queue = kit.createWebGpuInferenceQueue({ runtime, now: () => ++tick });
const documents = [];
const requestedPath = 'sharp/queue-state.json';
const publication = kit.createWebGpuInferenceQueuePublication({
  queue,
  publicationPath: requestedPath,
  producer: {
    producerId: 'sharp-browser-route',
    instanceId: 'browser-session-7',
    startedAt: '2026-07-31T19:30:00.000Z',
  },
  backendIdentity: {
    backend: 'webgpu',
    adapter: 'Apple M4 Max',
  },
  freshnessBudgetMs: 30_000,
  now: () => `2026-07-31T19:30:${String(documents.length).padStart(2, '0')}.000Z`,
  async publish(document, request) {
    assert.equal(request.publicationPath, requestedPath);
    documents.push(document);
    return {
      schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
      ok: true,
      requestedPath,
      effectivePath: requestedPath,
      routeId: document.effectiveRoute.routeId,
      producerInstanceId: document.producer.instanceId,
      bytes: 512,
      sha256: 'a'.repeat(64),
      atomicReplace: true,
      deletionAuthority: 'none',
      writtenAt: document.observedAt,
    };
  },
});

const handle = queue.enqueue({
  jobId: 'job-publish-me',
  metadata: { source: 'operator-drop' },
  async execute(context) {
    context.reportProgress({ stage: 'decode', completed: 1, total: 1 });
    return { path: 'outputs/publish-me.ply' };
  },
  describeOutput(output) {
    return {
      outputIdentity: 'publish-me-v1',
      artifacts: [{ kind: 'splat', path: output.path }],
    };
  },
});
await handle.completion;
await queue.drain();
const receipt = await publication.flush();

assert.equal(receipt.ok, true);
assert.ok(documents.length >= 4, 'initial, queued, running/progress, and completion state must publish');
const finalDocument = documents.at(-1);
assert.equal(finalDocument.schema, 'kaminos.webgpu-inference-queue-publication.v0');
assert.equal(finalDocument.producer.instanceId, 'browser-session-7');
assert.equal(finalDocument.producer.lifecycle, 'live');
assert.equal(finalDocument.effectiveRoute.routeId, routeId);
assert.equal(finalDocument.effectiveRoute.backendIdentity.backend, 'webgpu');
assert.equal(finalDocument.freshness.status, 'valid-until');
assert.equal(finalDocument.freshness.budgetMs, 30_000);
assert.equal(
  Date.parse(finalDocument.freshness.expiresAt) - Date.parse(finalDocument.freshness.observedAt),
  30_000,
);
assert.equal(finalDocument.freshness.evaluationAuthority, 'consumer-wall-clock');
assert.equal(finalDocument.queue.status, 'idle');
assert.deepEqual(finalDocument.queue.jobs[0].publication.artifacts, [
  { kind: 'splat', path: 'outputs/publish-me.ply' },
]);
assert.ok(documents.some(document => document.queue.jobs[0]?.progress.length === 1));

const mismatchQueue = kit.createWebGpuInferenceQueue({ runtime, now: () => ++tick });
const mismatched = kit.createWebGpuInferenceQueuePublication({
  queue: mismatchQueue,
  publicationPath: 'expected/state.json',
  producer: { instanceId: 'browser-session-mismatch', startedAt: '2026-07-31T19:31:00.000Z' },
  backendIdentity: { backend: 'webgpu' },
  freshnessBudgetMs: 30_000,
  async publish(document) {
    return {
      schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
      ok: true,
      requestedPath: 'unexpected/default.json',
      effectivePath: 'unexpected/default.json',
      routeId: document.effectiveRoute.routeId,
    };
  },
});
await assert.rejects(mismatched.flush(), /publication path mismatch/i);
assert.equal(mismatched.snapshot().lastFailure.phase, 'receipt-validation');
assert.equal(mismatched.snapshot().publicationFailures.length, 1);
assert.equal(mismatched.snapshot().publicationFailures[0].requestedPath, 'unexpected/default.json');
assert.equal(mismatched.snapshot().publicationFailures[0].effectivePath, 'unexpected/default.json');

const failedQueue = kit.createWebGpuInferenceQueue({ runtime, now: () => ++tick });
const failed = kit.createWebGpuInferenceQueuePublication({
  queue: failedQueue,
  publicationPath: 'failure/state.json',
  producer: { instanceId: 'browser-session-failure', startedAt: '2026-07-31T19:32:00.000Z' },
  backendIdentity: { backend: 'webgpu' },
  freshnessBudgetMs: 30_000,
  async publish() {
    const error = new Error('host publication unavailable');
    error.receipt = {
      schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
      ok: false,
      phase: 'atomic-replace',
      failureReportPath: 'failures/browser-session-failure.json',
    };
    throw error;
  },
});
await assert.rejects(failed.flush(), /host publication unavailable/);
assert.equal(failed.snapshot().lastFailure.phase, 'publish');
assert.equal(failed.snapshot().lastFailure.receipt.failureReportPath, 'failures/browser-session-failure.json');

const recoveringQueue = kit.createWebGpuInferenceQueue({ runtime, now: () => ++tick });
const recoveredDocuments = [];
let recoveringAttempts = 0;
const recovering = kit.createWebGpuInferenceQueuePublication({
  queue: recoveringQueue,
  publicationPath: 'recovery/state.json',
  producer: { instanceId: 'browser-session-recovery', startedAt: '2026-07-31T19:33:00.000Z' },
  backendIdentity: { backend: 'webgpu' },
  freshnessBudgetMs: 30_000,
  now: () => `2026-07-31T19:33:${String(recoveringAttempts).padStart(2, '0')}.000Z`,
  async publish(document) {
    recoveringAttempts += 1;
    if (recoveringAttempts === 1) {
      const error = new Error('first atomic replacement failed');
      error.receipt = {
        schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
        ok: false,
        phase: 'atomic-write',
        requestedPath: 'recovery/state.json',
        effectivePath: 'recovery/state.json',
        routeId,
        producerInstanceId: 'browser-session-recovery',
        failedAt: '2026-07-31T19:33:01.000Z',
        failureReportPath: 'failures/browser-session-recovery-1.json',
      };
      throw error;
    }
    recoveredDocuments.push(document);
    return {
      schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
      ok: true,
      requestedPath: 'recovery/state.json',
      effectivePath: 'recovery/state.json',
      routeId,
      producerInstanceId: 'browser-session-recovery',
      bytes: 512,
      sha256: 'b'.repeat(64),
      atomicReplace: true,
      deletionAuthority: 'none',
      writtenAt: document.observedAt,
    };
  },
});
await assert.rejects(recovering.flush(), /first atomic replacement failed/);
const recoveryJob = recoveringQueue.enqueue({
  jobId: 'job-after-publication-failure',
  async execute() { return null; },
});
await recoveryJob.completion;
await recoveringQueue.drain();
await recovering.flush();
assert.ok(recoveredDocuments.length > 0, 'a later queue mutation must recover durable publication');
for (const document of recoveredDocuments) {
  assert.equal(document.publicationFailures.length, 1, 'later durable documents must retain prior failures');
  const [publicationFailure] = document.publicationFailures;
  assert.equal(publicationFailure.publicationSequence, 1);
  assert.equal(publicationFailure.trigger.kind, 'publisher-started');
  assert.equal(publicationFailure.phase, 'publish');
  assert.equal(publicationFailure.requestedPath, 'recovery/state.json');
  assert.equal(publicationFailure.effectivePath, 'recovery/state.json');
  assert.equal(publicationFailure.routeId, routeId);
  assert.equal(publicationFailure.producerInstanceId, 'browser-session-recovery');
  assert.equal(publicationFailure.receipt.failureReportPath, 'failures/browser-session-recovery-1.json');
  assert.match(publicationFailure.failedAt, /^2026-07-31T19:33:/);
}
assert.equal(recovering.snapshot().publicationFailures.length, 1);

const substitutedProducerQueue = kit.createWebGpuInferenceQueue({ runtime, now: () => ++tick });
const substitutedProducer = kit.createWebGpuInferenceQueuePublication({
  queue: substitutedProducerQueue,
  publicationPath: 'substituted/state.json',
  producer: { instanceId: 'browser-session-expected', startedAt: '2026-07-31T19:34:00.000Z' },
  backendIdentity: { backend: 'webgpu' },
  freshnessBudgetMs: 30_000,
  async publish(document) {
    return {
      schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
      ok: true,
      requestedPath: 'substituted/state.json',
      effectivePath: 'substituted/state.json',
      routeId: document.effectiveRoute.routeId,
      producerInstanceId: 'browser-session-substituted',
      bytes: 512,
      sha256: 'c'.repeat(64),
      atomicReplace: true,
      deletionAuthority: 'none',
    };
  },
});
await assert.rejects(substitutedProducer.flush(), /producer instance mismatch/i);
assert.equal(
  substitutedProducer.snapshot().publicationFailures[0].receipt.producerInstanceId,
  'browser-session-substituted',
);

const weakReceiptQueue = kit.createWebGpuInferenceQueue({ runtime, now: () => ++tick });
const weakReceipt = kit.createWebGpuInferenceQueuePublication({
  queue: weakReceiptQueue,
  publicationPath: 'weak/state.json',
  producer: { instanceId: 'browser-session-weak', startedAt: '2026-07-31T19:35:00.000Z' },
  backendIdentity: { backend: 'webgpu' },
  freshnessBudgetMs: 30_000,
  async publish(document) {
    return {
      schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
      ok: true,
      requestedPath: 'weak/state.json',
      effectivePath: 'weak/state.json',
      routeId: document.effectiveRoute.routeId,
      producerInstanceId: 'browser-session-weak',
    };
  },
});
await assert.rejects(weakReceipt.flush(), /atomic replacement|byte count|sha-256|deletion authority/i);

let httpCall = null;
const httpPublisher = kit.createWebGpuInferenceQueueHttpPublisher({
  endpoint: '/api/webgpu-queue-publication',
  publicationPath: requestedPath,
  async fetch(endpoint, request) {
    httpCall = { endpoint, request };
    const payload = JSON.parse(request.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
          ok: true,
          requestedPath: payload.path,
          effectivePath: payload.path,
          routeId: payload.document.effectiveRoute.routeId,
          producerInstanceId: payload.document.producer.instanceId,
          bytes: 512,
          sha256: 'd'.repeat(64),
          atomicReplace: true,
          deletionAuthority: 'none',
        };
      },
    };
  },
});
const httpReceipt = await httpPublisher(finalDocument, { publicationPath: requestedPath });
assert.equal(httpReceipt.effectivePath, requestedPath);
assert.equal(httpCall.endpoint, '/api/webgpu-queue-publication');
assert.equal(httpCall.request.method, 'POST');
assert.deepEqual(JSON.parse(httpCall.request.body), { path: requestedPath, document: finalDocument });

const weakHttpPublisher = kit.createWebGpuInferenceQueueHttpPublisher({
  publicationPath: requestedPath,
  async fetch() {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
          ok: true,
          requestedPath,
          effectivePath: requestedPath,
          routeId,
          producerInstanceId: finalDocument.producer.instanceId,
        };
      },
    };
  },
});
await assert.rejects(
  weakHttpPublisher(finalDocument, { publicationPath: requestedPath }),
  /atomic replacement|byte count|sha-256|deletion authority/i,
);

const failedHttpPublisher = kit.createWebGpuInferenceQueueHttpPublisher({
  publicationPath: requestedPath,
  async fetch() {
    return {
      ok: false,
      status: 422,
      async json() {
        return {
          schema: 'kaminos.webgpu-inference-queue-publication-write-receipt.v0',
          ok: false,
          phase: 'atomic-write',
          failureReportPath: 'failures/browser-session-http.json',
          error: 'disk unavailable',
        };
      },
    };
  },
});
await assert.rejects(
  failedHttpPublisher(finalDocument, { publicationPath: requestedPath }),
  error => error.message === 'disk unavailable'
    && error.receipt.failureReportPath === 'failures/browser-session-http.json',
);

await publication.close();
console.log('inference queue publication contracts passed');
