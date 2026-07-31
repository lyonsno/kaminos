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
