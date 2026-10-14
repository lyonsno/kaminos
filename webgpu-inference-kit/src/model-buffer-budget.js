export const WEBGPU_MODEL_BUFFER_BUDGET_SCHEMA = 'kaminos.webgpu-model-buffer-budget.v0';

// Counts only buffers allocated through this scope, not renderer or driver RAM.
export function createWebGpuModelBufferBudget({ device, queue = device?.queue, maxBytes } = {}) {
  if (typeof device?.createBuffer !== 'function' || queue !== device.queue
    || typeof queue?.onSubmittedWorkDone !== 'function') {
    throw new TypeError('model buffer budget requires its device and exact completion-observable queue');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be an explicit positive safe-integer allowance');
  }
  const buffers = new Map(), retired = new Set(), seen = new WeakSet();
  let chargedBytes = 0, peakChargedBytes = 0, pendingRetirementBytes = 0;
  let reservedBytes = 0, refusalCount = 0, lastRefusal = null, failure = null, flushing = null;

  function recordFailure(error) {
    failure ||= error instanceof Error ? error
      : new Error(`resource settlement failed: ${String(error)}`, { cause: error });
  }

  function snapshot() {
    return {
      schema: WEBGPU_MODEL_BUFFER_BUDGET_SCHEMA,
      scope: 'model-allocated-api-visible-gpu-buffers', physicalMemoryMeasured: false,
      maxBytes, chargedBytes, peakChargedBytes, reservedBytes, pendingRetirementBytes,
      bufferCount: buffers.size, refusalCount, lastRefusal: lastRefusal && { ...lastRefusal },
      quarantined: failure !== null,
      failure: failure && { name: failure.name, message: failure.message },
    };
  }

  function observeRetirements() {
    if (flushing || failure || retired.size === 0) return;
    // Coalesce a synchronous destruction wave without blocking inference.
    flushing = Promise.resolve().then(async () => {
      const batch = [...retired];
      retired.clear();
      await queue.onSubmittedWorkDone();
      for (const row of batch) {
        chargedBytes -= row.bytes;
        pendingRetirementBytes -= row.bytes;
        row.state = 'settled';
        buffers.delete(row.buffer);
      }
    }).catch(recordFailure).finally(() => {
      flushing = null;
      observeRetirements();
    });
  }

  function retire(row) {
    row.state = 'retiring';
    pendingRetirementBytes += row.bytes;
    retired.add(row);
    observeRetirements();
  }

  function createBuffer(descriptor) {
    if (failure) {
      throw new Error('model buffer budget is quarantined after resource settlement failure', { cause: failure });
    }
    const bytes = descriptor?.size;
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new TypeError('budgeted buffer size must be a non-negative safe-integer');
    }
    if (bytes > maxBytes - chargedBytes) {
      refusalCount++;
      lastRefusal = { label: descriptor.label ?? null, requestedBytes: bytes,
        chargedBytes, pendingRetirementBytes, maxBytes };
      const error = new Error(`model GPU buffer budget exceeded before allocation: ${chargedBytes} + ${bytes} > ${maxBytes}`);
      error.name = 'WebGpuBufferBudgetError';
      error.memoryBudget = { ...lastRefusal };
      throw error;
    }
    chargedBytes += bytes;
    reservedBytes += bytes;
    let buffer;
    try { buffer = device.createBuffer({ ...descriptor }); }
    catch (error) { chargedBytes -= bytes; reservedBytes -= bytes; throw error; }
    reservedBytes -= bytes;
    if (!buffer || typeof buffer !== 'object' || buffer.size !== bytes
      || typeof buffer.destroy !== 'function' || seen.has(buffer)) {
      failure = new Error('device returned an invalid or reused budgeted GPUBuffer');
      throw failure;
    }
    seen.add(buffer);
    const row = { buffer, bytes, state: 'live' }, originalDestroy = buffer.destroy;
    buffers.set(buffer, row);
    peakChargedBytes = Math.max(peakChargedBytes, chargedBytes);
    function destroy(...args) {
      if (this !== buffer) return Reflect.apply(originalDestroy, this, args);
      if (row.state !== 'live') return;
      try { Reflect.apply(originalDestroy, buffer, args); }
      catch (error) { recordFailure(error); throw error; }
      retire(row);
    }
    try {
      Object.defineProperty(buffer, 'destroy', { value: destroy, configurable: true, writable: true });
    } catch (error) {
      // A buffer we cannot observe must not escape as an admitted allocation.
      try { Reflect.apply(originalDestroy, buffer, []); retire(row); }
      catch (cleanupError) { recordFailure(cleanupError); throw new AggregateError([error, cleanupError], 'buffer guard installation and cleanup failed'); }
      throw error;
    }
    return buffer;
  }

  return Object.freeze({
    schema: WEBGPU_MODEL_BUFFER_BUDGET_SCHEMA, device, queue, createBuffer, snapshot,
    async settleRetirements() {
      while (flushing) await flushing;
      if (failure) throw failure;
      return snapshot();
    },
  });
}
