export const WEBGPU_INFERENCE_QUEUE_PUBLICATION_SCHEMA = 'kaminos.webgpu-inference-queue-publication.v0';
export const WEBGPU_INFERENCE_QUEUE_PUBLICATION_WRITE_RECEIPT_SCHEMA = 'kaminos.webgpu-inference-queue-publication-write-receipt.v0';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function serializeFailure(error, phase) {
  return deepFreeze({
    phase,
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : String(error),
    ...(error?.receipt ? { receipt: clone(error.receipt) } : {}),
  });
}

function validateWriteReceipt(receipt, publicationPath, routeId, producerInstanceId) {
  function fail(message) {
    const error = new Error(message);
    if (receipt && typeof receipt === 'object') error.receipt = clone(receipt);
    throw error;
  }
  if (!receipt || typeof receipt !== 'object') fail('publication write receipt must be an object');
  if (receipt.schema !== WEBGPU_INFERENCE_QUEUE_PUBLICATION_WRITE_RECEIPT_SCHEMA) {
    fail(`unexpected publication write receipt schema ${receipt.schema || '<missing>'}`);
  }
  if (receipt.ok !== true) fail('publication write receipt reports failure');
  if (receipt.requestedPath !== publicationPath || receipt.effectivePath !== publicationPath) {
    fail(`publication path mismatch: requested ${publicationPath}, wrote ${receipt.effectivePath || '<missing>'}`);
  }
  if (receipt.routeId !== routeId) {
    fail(`publication route mismatch: expected ${routeId}, wrote ${receipt.routeId || '<missing>'}`);
  }
  if (receipt.producerInstanceId !== producerInstanceId) {
    fail(`publication producer instance mismatch: expected ${producerInstanceId}, wrote ${receipt.producerInstanceId || '<missing>'}`);
  }
  if (receipt.atomicReplace !== true) {
    fail('publication receipt must prove atomic replacement');
  }
  if (receipt.deletionAuthority !== 'none') {
    fail('publication receipt deletion authority must be none');
  }
  if (!Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0) {
    fail('publication receipt byte count must be a positive safe integer');
  }
  if (typeof receipt.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(receipt.sha256)) {
    fail('publication receipt SHA-256 must be a 64-digit hexadecimal digest');
  }
  return receipt;
}

export function createWebGpuInferenceQueuePublication(input = {}) {
  const queue = input.queue;
  if (!queue || typeof queue.snapshot !== 'function' || typeof queue.subscribe !== 'function') {
    throw new Error('queue must expose snapshot and subscribe');
  }
  if (typeof input.publish !== 'function') throw new Error('publish must be a function');
  const publicationPath = nonEmptyString(input.publicationPath, 'publicationPath');
  const initialQueue = queue.snapshot();
  const routeId = nonEmptyString(initialQueue.routeId, 'queue routeId');
  const producer = clone(input.producer || {});
  producer.instanceId = nonEmptyString(producer.instanceId, 'producer.instanceId');
  producer.startedAt = nonEmptyString(producer.startedAt, 'producer.startedAt');
  const backendIdentity = clone(input.backendIdentity || {});
  if (Object.keys(backendIdentity).length === 0) throw new Error('backendIdentity must be a non-empty object');
  const freshnessBudgetMs = Number(input.freshnessBudgetMs);
  if (!Number.isFinite(freshnessBudgetMs) || freshnessBudgetMs <= 0) {
    throw new Error('freshnessBudgetMs must be a positive finite number');
  }
  const now = input.now || (() => new Date().toISOString());
  if (typeof now !== 'function') throw new Error('now must be a function');
  const setIntervalImplementation = input.setInterval || globalThis.setInterval;
  const clearIntervalImplementation = input.clearInterval || globalThis.clearInterval;
  if (typeof setIntervalImplementation !== 'function' || typeof clearIntervalImplementation !== 'function') {
    throw new Error('setInterval and clearInterval must be available');
  }

  let sequence = 0;
  let closed = false;
  let lastReceipt = null;
  let lastFailure = null;
  const publicationFailures = [];
  let tail = Promise.resolve(null);

  function makeDocument(event, lifecycle, publicationSequence) {
    const observedAt = nonEmptyString(now(), 'publication observedAt');
    const observedAtMs = Date.parse(observedAt);
    if (!Number.isFinite(observedAtMs)) throw new Error('publication observedAt must be an ISO timestamp');
    const expiresAt = new Date(observedAtMs + freshnessBudgetMs).toISOString();
    return deepFreeze({
      schema: WEBGPU_INFERENCE_QUEUE_PUBLICATION_SCHEMA,
      publicationSequence,
      publicationPath,
      observedAt,
      producer: {
        ...clone(producer),
        lifecycle,
      },
      effectiveRoute: {
        routeId,
        backendIdentity: clone(backendIdentity),
      },
      freshness: {
        status: lifecycle === 'live' ? 'valid-until' : 'closed',
        observedAt,
        ...(lifecycle === 'live' ? { expiresAt } : {}),
        budgetMs: freshnessBudgetMs,
        evaluationAuthority: 'consumer-wall-clock',
      },
      trigger: {
        kind: event.kind,
        mutationSequence: event.sequence ?? null,
        atMs: event.atMs ?? null,
      },
      publicationFailures: clone(publicationFailures),
      queue: clone(event.queue),
      retentionAuthority: 'queue-explicit-forget-only',
      deletionAuthority: 'none',
    });
  }

  function recordFailure(error, phase, publicationSequence, event) {
    const serialized = serializeFailure(error, phase);
    const receipt = serialized.receipt || {};
    const failedAt = typeof receipt.failedAt === 'string' && receipt.failedAt
      ? receipt.failedAt
      : nonEmptyString(now(), 'publication failure timestamp');
    const failure = deepFreeze({
      publicationSequence,
      trigger: {
        kind: event.kind,
        mutationSequence: event.sequence ?? null,
        atMs: event.atMs ?? null,
      },
      phase,
      failedAt,
      requestedPath: receipt.requestedPath ?? publicationPath,
      effectivePath: receipt.effectivePath ?? null,
      routeId: receipt.routeId ?? routeId,
      producerInstanceId: receipt.producerInstanceId ?? producer.instanceId,
      name: serialized.name,
      message: serialized.message,
      ...(serialized.receipt ? { receipt: clone(serialized.receipt) } : {}),
    });
    publicationFailures.push(failure);
    lastFailure = failure;
  }

  function schedule(event, lifecycle = 'live') {
    const publicationSequence = sequence + 1;
    sequence = publicationSequence;
    tail = tail.catch(() => null).then(async () => {
      const document = makeDocument(event, lifecycle, publicationSequence);
      let receipt;
      try {
        receipt = await input.publish(document, { publicationPath });
      } catch (error) {
        recordFailure(error, 'publish', publicationSequence, event);
        throw error;
      }
      try {
        validateWriteReceipt(receipt, publicationPath, routeId, producer.instanceId);
      } catch (error) {
        recordFailure(error, 'receipt-validation', publicationSequence, event);
        throw error;
      }
      lastReceipt = deepFreeze(clone(receipt));
      return lastReceipt;
    });
    tail.catch(() => {});
    return tail;
  }

  const unsubscribe = queue.subscribe(event => {
    if (!closed) schedule(event);
  });
  schedule({ kind: 'publisher-started', sequence: 0, atMs: null, queue: initialQueue });
  const heartbeat = setIntervalImplementation(() => {
    if (!closed) {
      schedule({
        kind: 'publisher-heartbeat',
        sequence: null,
        atMs: null,
        queue: queue.snapshot(),
      });
    }
  }, Math.max(1, Math.floor(freshnessBudgetMs / 2)));
  heartbeat?.unref?.();

  return Object.freeze({
    flush() {
      return tail;
    },
    snapshot() {
      return deepFreeze({
        schema: WEBGPU_INFERENCE_QUEUE_PUBLICATION_SCHEMA,
        publicationPath,
        routeId,
        producer: clone(producer),
        backendIdentity: clone(backendIdentity),
        freshnessBudgetMs,
        lifecycle: closed ? 'closed' : 'live',
        publicationSequence: sequence,
        lastReceipt: clone(lastReceipt),
        lastFailure: clone(lastFailure),
        publicationFailures: clone(publicationFailures),
      });
    },
    async close() {
      if (closed) return tail;
      closed = true;
      unsubscribe();
      clearIntervalImplementation(heartbeat);
      return schedule({
        kind: 'publisher-closed',
        sequence: null,
        atMs: null,
        queue: queue.snapshot(),
      }, 'closed');
    },
  });
}

export function createWebGpuInferenceQueueHttpPublisher(input = {}) {
  const endpoint = nonEmptyString(input.endpoint || '/api/webgpu-queue-publication', 'endpoint');
  const publicationPath = nonEmptyString(input.publicationPath, 'publicationPath');
  const fetchImplementation = input.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== 'function') throw new Error('fetch must be available');

  return async function publishQueueDocument(document, request = {}) {
    const requestedPath = request.publicationPath || publicationPath;
    if (requestedPath !== publicationPath) {
      throw new Error(`publication path mismatch: configured ${publicationPath}, requested ${requestedPath}`);
    }
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: publicationPath, document }),
    });
    let receipt;
    try {
      receipt = await response.json();
    } catch (error) {
      throw new Error(`queue publication endpoint returned invalid JSON: ${error.message}`);
    }
    if (!response.ok || receipt?.ok !== true) {
      const error = new Error(receipt?.error || `queue publication failed with HTTP ${response.status}`);
      error.receipt = receipt;
      throw error;
    }
    return validateWriteReceipt(
      receipt,
      publicationPath,
      document?.effectiveRoute?.routeId,
      document?.producer?.instanceId,
    );
  };
}
