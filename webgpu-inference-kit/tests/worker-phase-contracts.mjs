import assert from 'node:assert/strict';

import * as kit from '../src/index.js';

assert.equal(
  typeof kit.runWebGpuWorkerPhase,
  'function',
  'the public runtime must expose a transferable worker-phase executor',
);

const {
  WEBGPU_WORKER_PHASE_PROGRESS_SCHEMA,
  WEBGPU_WORKER_PHASE_REPORT_SCHEMA,
  WEBGPU_WORKER_PHASE_REQUEST_SCHEMA,
  WEBGPU_WORKER_PHASE_RESULT_SCHEMA,
  runWebGpuWorkerPhase,
} = kit;

const MODULE_ID = 'test.materialize-worker.v0';
let nextExecution = 1;

function validIdentity(overrides = {}) {
  return {
    moduleId: MODULE_ID,
    workerType: 'module',
    source: '/workers/materialize.js',
    ...overrides,
  };
}

class FakeWorker {
  constructor(options = {}) {
    this.options = options;
    this.listeners = new Map();
    this.addCalls = [];
    this.removeCalls = [];
    this.postCalls = [];
    this.terminateCalls = 0;
  }

  addEventListener(type, listener) {
    this.addCalls.push(type);
    if (this.options.throwAdd === type) throw new Error(`add ${type} failed`);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.removeCalls.push(type);
    if (this.options.throwRemove === type) throw new Error(`remove ${type} failed`);
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message, transfer) {
    this.postCalls.push({ message, transfer });
    if (this.options.throwPost) throw new Error('DataCloneError');
    this.options.onPost?.(this, message, transfer);
  }

  terminate() {
    this.terminateCalls += 1;
    if (this.options.throwTerminate) throw new Error('terminate failed');
  }

  emit(type, value) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(value);
  }
}

function workerFactory(worker, identity = validIdentity()) {
  return () => ({ worker, identity });
}

function request(overrides = {}) {
  return {
    executionId: `execution-${nextExecution++}`,
    operationId: 'texture-materialize',
    moduleId: MODULE_ID,
    createWorker: overrides.worker
      ? workerFactory(overrides.worker, overrides.identity || validIdentity())
      : overrides.createWorker,
    payload: { resolution: 64 },
    transfer: [],
    validateOutput(output) {
      assert.ok(output instanceof Uint8Array);
      return output;
    },
    ...overrides,
  };
}

function completedResult(message, output = new Uint8Array([1, 2, 3])) {
  return {
    schema: WEBGPU_WORKER_PHASE_RESULT_SCHEMA,
    executionId: message.executionId,
    operationId: message.operationId,
    moduleId: message.moduleId,
    status: 'completed',
    output,
  };
}

function failedResult(message, text = 'worker exploded') {
  return {
    schema: WEBGPU_WORKER_PHASE_RESULT_SCHEMA,
    executionId: message.executionId,
    operationId: message.operationId,
    moduleId: message.moduleId,
    status: 'failed',
    error: {
      name: 'MaterializeError',
      message: text,
    },
  };
}

function progressResult(message, sequence, progress) {
  return {
    schema: WEBGPU_WORKER_PHASE_PROGRESS_SCHEMA,
    executionId: message.executionId,
    operationId: message.operationId,
    moduleId: message.moduleId,
    sequence,
    progress,
  };
}

async function captureFailure(input) {
  try {
    await runWebGpuWorkerPhase(input);
  } catch (error) {
    assert.ok(error.workerPhaseReport, 'worker failures must carry a terminal report');
    return error;
  }
  assert.fail('expected worker phase failure');
}

{
  const worker = new FakeWorker({
    onPost(instance, message) {
      queueMicrotask(() => {
        instance.emit('message', { data: progressResult(message, 0, { completed: 1, total: 2 }) });
        instance.emit('message', { data: progressResult(message, 1, { completed: 2, total: 2 }) });
        instance.emit('message', { data: completedResult(message) });
      });
    },
  });
  const progress = [];
  const transferBuffer = new ArrayBuffer(16);
  const result = await runWebGpuWorkerPhase(request({
    worker,
    payload: { transferBuffer },
    transfer: [transferBuffer],
    onProgress(event) {
      progress.push(event);
    },
  }));

  assert.deepEqual([...result.output], [1, 2, 3]);
  assert.equal(result.report.schema, WEBGPU_WORKER_PHASE_REPORT_SCHEMA);
  assert.equal(result.report.status, 'completed');
  assert.equal(result.report.workerIdentity.moduleId, MODULE_ID);
  assert.equal(result.report.transferOwnership, 'transferred');
  assert.equal(result.report.transferCount, 1);
  assert.equal(result.report.timeoutMs, null);
  assert.equal(result.report.progress.length, 2);
  assert.equal(result.report.history.at(-1).kind, 'completed');
  assert.deepEqual(progress.map(event => event.sequence), [0, 1]);
  assert.equal(worker.postCalls.length, 1);
  assert.equal(worker.postCalls[0].message.schema, WEBGPU_WORKER_PHASE_REQUEST_SCHEMA);
  assert.deepEqual(worker.postCalls[0].transfer, [transferBuffer]);
  assert.equal(worker.terminateCalls, 1);
  assert.deepEqual(worker.addCalls, ['message', 'error', 'messageerror']);
  assert.deepEqual(worker.removeCalls, ['message', 'error', 'messageerror']);
  assert.ok(Object.isFrozen(result.report));
}

{
  const controller = new AbortController();
  const worker = new FakeWorker();
  const pending = runWebGpuWorkerPhase(request({ worker, signal: controller.signal }));
  await new Promise(resolve => setTimeout(resolve, 15));
  controller.abort('caller moved on');
  const error = await pending.catch(value => value);
  assert.equal(error.name, 'AbortError');
  assert.equal(error.workerPhaseReport.status, 'canceled');
  assert.equal(error.workerPhaseReport.timeoutMs, null, 'the runtime must not invent a deadline');
  assert.equal(error.workerPhaseReport.transferOwnership, 'transferred');
  assert.equal(worker.terminateCalls, 1);
}

{
  const controller = new AbortController();
  controller.abort('already canceled');
  let factoryCalls = 0;
  const error = await captureFailure(request({
    signal: controller.signal,
    createWorker() {
      factoryCalls += 1;
      return {};
    },
  }));
  assert.equal(error.name, 'AbortError');
  assert.equal(error.workerPhaseReport.status, 'canceled');
  assert.equal(error.workerPhaseReport.phase, 'admission');
  assert.equal(error.workerPhaseReport.transferOwnership, 'retained');
  assert.equal(factoryCalls, 0);
}

{
  const worker = new FakeWorker();
  const error = await captureFailure(request({ worker, timeoutMs: 5 }));
  assert.equal(error.name, 'TimeoutError');
  assert.equal(error.workerPhaseReport.status, 'timed-out');
  assert.equal(error.workerPhaseReport.timeoutMs, 5);
  assert.equal(worker.terminateCalls, 1);
}

for (const field of ['maxProgressEvents', 'maxHistory', 'retentionLimit']) {
  await assert.rejects(
    () => runWebGpuWorkerPhase(request({
      worker: new FakeWorker(),
      [field]: 1,
    })),
    /uncapped/,
  );
}

{
  const error = await captureFailure(request({
    createWorker() {
      throw new Error('constructor unavailable');
    },
  }));
  assert.match(error.message, /constructor unavailable/);
  assert.equal(error.workerPhaseReport.phase, 'worker-create');
  assert.equal(error.workerPhaseReport.cleanup.status, 'not-created');
}

{
  const worker = new FakeWorker();
  const error = await captureFailure(request({
    worker,
    identity: validIdentity({ moduleId: 'wrong.module' }),
  }));
  assert.match(error.message, /module identity mismatch/);
  assert.equal(error.workerPhaseReport.phase, 'worker-create');
  assert.equal(worker.terminateCalls, 1);
}

{
  const worker = new FakeWorker();
  let postAccesses = 0;
  Object.defineProperty(worker, 'postMessage', {
    get() {
      postAccesses += 1;
      throw new Error('get postMessage failed');
    },
  });
  const error = await captureFailure(request({ worker }));
  assert.match(error.message, /get postMessage failed/);
  assert.equal(error.workerPhaseReport.phase, 'worker-capabilities');
  assert.equal(error.workerPhaseReport.cleanup.status, 'terminated');
  assert.equal(worker.terminateCalls, 1);
  assert.equal(postAccesses, 1);
}

{
  const worker = new FakeWorker({ throwAdd: 'error' });
  const error = await captureFailure(request({ worker }));
  assert.match(error.message, /add error failed/);
  assert.equal(error.workerPhaseReport.phase, 'listener-setup');
  assert.equal(worker.terminateCalls, 1);
  assert.deepEqual(worker.removeCalls, ['message']);
}

{
  const worker = new FakeWorker({ throwPost: true });
  const error = await captureFailure(request({ worker }));
  assert.match(error.message, /DataCloneError/);
  assert.equal(error.workerPhaseReport.phase, 'dispatch');
  assert.equal(error.workerPhaseReport.transferOwnership, 'retained');
  assert.equal(worker.terminateCalls, 1);
}

{
  const worker = new FakeWorker({
    onPost(instance, message) {
      queueMicrotask(() => instance.emit('message', {
        data: completedResult({ ...message, executionId: 'stale-execution' }),
      }));
    },
  });
  const error = await captureFailure(request({ worker }));
  assert.match(error.message, /execution identity mismatch/);
  assert.equal(error.workerPhaseReport.phase, 'response-validation');
}

{
  const worker = new FakeWorker({
    onPost(instance, message) {
      queueMicrotask(() => instance.emit('message', { data: completedResult(message, 'wrong') }));
    },
  });
  const error = await captureFailure(request({ worker }));
  assert.match(error.message, /Uint8Array/);
  assert.equal(error.workerPhaseReport.phase, 'output-validation');
}

{
  const worker = new FakeWorker({
    onPost(instance, message) {
      queueMicrotask(() => instance.emit('message', { data: completedResult(message) }));
    },
  });
  const error = await captureFailure(request({
    worker,
    validateOutput(output) {
      return Promise.resolve(output);
    },
  }));
  assert.match(error.message, /must complete synchronously/);
  assert.equal(error.workerPhaseReport.phase, 'output-validation');
}

{
  const worker = new FakeWorker();
  const identityFailure = Object.preventExtensions(new Error('identity getter failed'));
  const created = { worker };
  Object.defineProperty(created, 'identity', {
    get() {
      throw identityFailure;
    },
  });
  const error = await captureFailure(request({
    createWorker() {
      return created;
    },
  }));
  assert.match(error.message, /identity getter failed/);
  assert.equal(error.workerPhaseReport.phase, 'worker-create');
  assert.equal(worker.terminateCalls, 1);
}

{
  const worker = new FakeWorker({
    onPost(instance, message) {
      queueMicrotask(() => instance.emit('message', { data: failedResult(message) }));
    },
  });
  const error = await captureFailure(request({ worker }));
  assert.equal(error.name, 'MaterializeError');
  assert.match(error.message, /worker exploded/);
  assert.equal(error.workerPhaseReport.phase, 'worker-operation');
}

for (const [eventType, expectedPhase, event] of [
  ['error', 'worker-execution', { message: 'top-level throw', error: new Error('top-level throw') }],
  ['messageerror', 'response-deserialization', {}],
]) {
  const worker = new FakeWorker({
    onPost(instance) {
      queueMicrotask(() => instance.emit(eventType, event));
    },
  });
  const error = await captureFailure(request({ worker }));
  assert.equal(error.workerPhaseReport.phase, expectedPhase);
  assert.equal(worker.terminateCalls, 1);
}

{
  const worker = new FakeWorker({ throwTerminate: true });
  worker.options.onPost = (instance, message) => {
    queueMicrotask(() => instance.emit('message', { data: completedResult(message) }));
  };
  const result = await runWebGpuWorkerPhase(request({ worker }));
  assert.equal(result.report.status, 'completed');
  assert.equal(result.report.cleanup.status, 'cleanup-failed');
  assert.match(result.report.cleanup.failures[0].message, /terminate failed/);
}

{
  const worker = new FakeWorker({ throwRemove: 'message', throwTerminate: true });
  worker.options.onPost = instance => {
    queueMicrotask(() => instance.emit('error', {
      message: 'primary worker crash',
      error: new Error('primary worker crash'),
    }));
  };
  const error = await captureFailure(request({ worker }));
  assert.match(error.message, /primary worker crash/);
  assert.equal(error.workerPhaseReport.cleanup.status, 'cleanup-failed');
  assert.equal(error.workerPhaseReport.cleanup.failures.length, 2);
}

console.log('worker phase contracts passed');
