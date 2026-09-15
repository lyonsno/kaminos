export const WEBGPU_SCRATCH_ARENA_SCHEMA = 'kaminos.webgpu-scratch-arena.v0';
export const WEBGPU_SCRATCH_ARENA_USE_SCHEMA = 'kaminos.webgpu-scratch-arena-use.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneJson(value, label, path = label, ancestors = new Set()) {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${label} must be JSON-compatible; invalid number at ${path}`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} must be JSON-compatible; unsupported ${typeof value} at ${path}`);
  }
  if (ancestors.has(value)) throw new Error(`${label} must be JSON-compatible; cycle at ${path}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const clone = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw new Error(`${label} must be JSON-compatible; invalid array element at ${path}[${index}]`);
        }
        clone[index] = cloneJson(descriptor.value, label, `${path}[${index}]`, ancestors);
      }
      const namedKeys = Reflect.ownKeys(value).filter(key => (
        key !== 'length' && (typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key))
      ));
      if (namedKeys.length > 0) {
        throw new Error(`${label} must be JSON-compatible; named array property at ${path}`);
      }
      return clone;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must be JSON-compatible; non-plain object at ${path}`);
    }
    const clone = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') throw new Error(`${label} must be JSON-compatible; symbol key at ${path}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`${label} must be JSON-compatible; invalid property at ${path}.${key}`);
      }
      clone[key] = cloneJson(descriptor.value, label, `${path}.${key}`, ancestors);
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function addSafeBytes(total, bytes, label) {
  const next = total + bytes;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceed the safe integer range`);
  return next;
}

function abortError(signal) {
  const error = new Error(String(signal?.reason || 'scratch arena use aborted'));
  error.name = 'AbortError';
  return error;
}

function errorWithReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!Object.hasOwn(error, 'scratchArenaReport')) {
    try {
      error.scratchArenaReport = report;
      if (error.scratchArenaReport === report) return error;
    } catch {}
  }
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.scratchArenaReport = report;
  return wrapped;
}

function normalizeSlots(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('scratch arena slots must be a non-empty array');
  }
  const seen = new Set();
  let declaredBytes = 0;
  const slots = input.map((slot, index) => {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      throw new Error(`scratch arena slots[${index}] must be an object`);
    }
    if (!isNonEmptyString(slot.slotId)) {
      throw new Error(`scratch arena slots[${index}].slotId must be a non-empty string`);
    }
    if (seen.has(slot.slotId)) throw new Error(`duplicate scratch slot ${slot.slotId}`);
    if (!Number.isSafeInteger(slot.declaredBytes) || slot.declaredBytes < 0) {
      throw new Error(`scratch slot ${slot.slotId} declaredBytes must be a non-negative safe integer`);
    }
    seen.add(slot.slotId);
    declaredBytes = addSafeBytes(declaredBytes, slot.declaredBytes, 'scratch arena declared bytes');
    return deepFreeze({
      slotId: slot.slotId,
      declaredBytes: slot.declaredBytes,
      metadata: cloneJson(slot.metadata ?? null, `scratch slot ${slot.slotId} metadata`),
    });
  });
  return { slots: Object.freeze(slots), declaredBytes };
}

function allocationDisposer(allocation, slotId) {
  if (typeof allocation.dispose === 'function') {
    return () => {
      const result = allocation.dispose(allocation.resource);
      if (result != null && typeof result.then === 'function') {
        throw new Error(`scratch slot ${slotId} disposer must complete synchronously`);
      }
    };
  }
  if (typeof allocation.resource?.destroy === 'function') {
    return () => {
      const result = allocation.resource.destroy();
      if (result != null && typeof result.then === 'function') {
        throw new Error(`scratch slot ${slotId} destroy must complete synchronously`);
      }
    };
  }
  throw new Error(`scratch slot ${slotId} allocation requires dispose(resource) or resource.destroy()`);
}

function disposeAllocations(allocations, reason) {
  const disposedSlotIds = [];
  const failures = [];
  for (const allocation of [...allocations].reverse()) {
    if (allocation.disposed) continue;
    try {
      allocation.dispose();
      allocation.disposed = true;
      disposedSlotIds.push(allocation.slot.slotId);
    } catch (error) {
      failures.push({
        slotId: allocation.slot.slotId,
        message: String(error?.message || error),
      });
    }
  }
  return deepFreeze({
    reason,
    status: failures.length > 0 ? 'dispose-failed' : 'disposed',
    disposedSlotIds,
    failures,
  });
}

function normalizeAuthority(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isNonEmptyString(value.kind)) {
    throw new Error('scratch arena completion authority must be an object with a non-empty kind');
  }
  return deepFreeze(cloneJson(value, 'scratch arena completion authority'));
}

export function createWebGpuScratchArena(input = {}) {
  if (
    input.maxSlots != null
    || input.maxBytes != null
    || input.maxUses != null
    || input.retentionLimit != null
  ) {
    throw new Error('scratch arenas are uncapped; maxSlots, maxBytes, maxUses, and retentionLimit are not supported');
  }
  if (!isNonEmptyString(input.arenaId)) throw new Error('scratch arenaId must be a non-empty string');
  if (typeof input.allocateSlot !== 'function') {
    throw new Error('scratch arena allocateSlot must be a function');
  }
  const now = input.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  if (typeof now !== 'function') throw new Error('scratch arena now must be a function');
  const normalized = normalizeSlots(input.slots);
  const metadata = deepFreeze(cloneJson(input.metadata ?? null, 'scratch arena metadata'));
  const allocations = [];
  const allocationBySlotId = new Map();
  let allocatedBytes = 0;

  for (const slot of normalized.slots) {
    try {
      const value = input.allocateSlot(slot);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`scratch slot ${slot.slotId} allocation must return an object`);
      }
      if (!Object.hasOwn(value, 'resource')) {
        throw new Error(`scratch slot ${slot.slotId} allocation must return resource`);
      }
      const allocation = {
        slot,
        resource: value.resource,
        allocatedBytes: 0,
        dispose: allocationDisposer(value, slot.slotId),
        disposed: false,
      };
      allocations.push(allocation);
      const allocationBytes = value.allocatedBytes ?? slot.declaredBytes;
      if (!Number.isSafeInteger(allocationBytes) || allocationBytes < 0) {
        throw new Error(`scratch slot ${slot.slotId} allocatedBytes must be a non-negative safe integer`);
      }
      allocation.allocatedBytes = allocationBytes;
      allocatedBytes = addSafeBytes(allocatedBytes, allocationBytes, 'scratch arena allocated bytes');
      allocationBySlotId.set(slot.slotId, allocation);
    } catch (cause) {
      const cleanup = disposeAllocations(allocations, 'allocation-rollback');
      throw errorWithReport(cause, deepFreeze({
        schema: WEBGPU_SCRATCH_ARENA_SCHEMA,
        arenaId: input.arenaId,
        status: cleanup.status === 'disposed' ? 'allocation-failed' : 'allocation-cleanup-failed',
        failedSlotId: slot.slotId,
        allocatedSlotIds: allocations.map(allocation => allocation.slot.slotId),
        disposedSlotIds: cleanup.disposedSlotIds,
        cleanup,
      }));
    }
  }

  const state = {
    status: 'available',
    activeUse: null,
    useCount: 0,
    usedIds: new Set(),
    history: [],
    closedAtMs: null,
    terminalReason: null,
  };

  function activeBytes() {
    return allocations.reduce(
      (total, allocation) => allocation.disposed
        ? total
        : addSafeBytes(total, allocation.allocatedBytes, 'scratch arena active bytes'),
      0,
    );
  }

  function snapshot() {
    return deepFreeze({
      schema: WEBGPU_SCRATCH_ARENA_SCHEMA,
      arenaId: input.arenaId,
      status: state.status,
      metadata,
      slotIds: normalized.slots.map(slot => slot.slotId),
      slots: normalized.slots.map(slot => ({ ...slot })),
      declaredBytes: normalized.declaredBytes,
      allocatedBytes,
      activeBytes: activeBytes(),
      allocationCount: allocations.length,
      useCount: state.useCount,
      activeUse: state.activeUse ? {
        useId: state.activeUse.useId,
        useSequence: state.activeUse.useSequence,
        status: state.activeUse.status,
        startedAtMs: state.activeUse.startedAtMs,
        submittedAtMs: state.activeUse.submittedAtMs,
        authority: state.activeUse.authority,
      } : null,
      history: state.history.map(entry => ({ ...entry })),
      closedAtMs: state.closedAtMs,
      terminalReason: state.terminalReason,
    });
  }

  function assertUsable() {
    if (state.status === 'closed') throw new Error('scratch arena is closed');
    if (state.status === 'invalidated') throw new Error('scratch arena is invalidated');
    if (state.status === 'dispose-failed') throw new Error('scratch arena disposal failed');
  }

  function finalizeUse(useState, status, details = {}) {
    const completedAtMs = now();
    const record = deepFreeze({
      schema: WEBGPU_SCRATCH_ARENA_USE_SCHEMA,
      arenaId: input.arenaId,
      useId: useState.useId,
      useSequence: useState.useSequence,
      status,
      startedAtMs: useState.startedAtMs,
      submittedAtMs: useState.submittedAtMs,
      completedAtMs,
      authority: useState.authority,
      reason: details.reason ?? null,
      failure: details.failure ?? null,
    });
    state.history.push(record);
    state.activeUse = null;
    return record;
  }

  function beginUse(options = {}) {
    assertUsable();
    if (state.activeUse) throw new Error(`scratch arena use ${state.activeUse.useId} is already active`);
    if (!isNonEmptyString(options.useId)) throw new Error('scratch arena useId must be a non-empty string');
    if (state.usedIds.has(options.useId)) throw new Error(`scratch arena useId ${options.useId} was already used`);
    if (options.signal?.aborted) throw abortError(options.signal);

    const useState = {
      useId: options.useId,
      useSequence: state.useCount + 1,
      status: 'active',
      startedAtMs: now(),
      submittedAtMs: null,
      authority: null,
    };
    state.useCount += 1;
    state.usedIds.add(options.useId);
    state.activeUse = useState;
    state.status = 'active';

    function assertActive() {
      if (state.activeUse !== useState || useState.status !== 'active') {
        throw new Error(`scratch arena use ${useState.useId} is no longer active`);
      }
    }

    function resource(slotId) {
      assertActive();
      const allocation = allocationBySlotId.get(slotId);
      if (!allocation) throw new Error(`unknown scratch slot ${slotId || '<missing>'}`);
      return allocation.resource;
    }

    function abandon(abandonOptions = {}) {
      if (state.activeUse === useState && useState.status === 'submitted') {
        throw new Error(`scratch arena use ${useState.useId} is already submitted`);
      }
      assertActive();
      useState.status = 'abandoned';
      const record = finalizeUse(useState, 'abandoned', {
        reason: abandonOptions.reason ?? null,
      });
      state.status = 'available';
      return record;
    }

    function markSubmitted(submission = {}) {
      assertActive();
      if (!submission.completion || typeof submission.completion.then !== 'function') {
        throw new Error('scratch arena submitted use requires a completion promise');
      }
      const authority = normalizeAuthority(submission.authority);
      useState.status = 'submitted';
      useState.submittedAtMs = now();
      useState.authority = authority;
      state.status = 'submitted';

      return Promise.resolve(submission.completion).then(
        () => {
          if (state.activeUse !== useState || useState.status !== 'submitted') {
            throw new Error(`scratch arena submitted use ${useState.useId} lost ownership`);
          }
          useState.status = 'completed';
          const record = finalizeUse(useState, 'completed');
          state.status = 'available';
          return record;
        },
        cause => {
          const failure = {
            name: cause?.name || 'Error',
            message: String(cause?.message || cause),
          };
          const cleanup = disposeAllocations(allocations, 'completion-rejected');
          useState.status = 'failed';
          const record = finalizeUse(useState, 'failed', { failure });
          state.status = cleanup.status === 'disposed' ? 'invalidated' : 'dispose-failed';
          state.closedAtMs = now();
          state.terminalReason = failure.message;
          throw errorWithReport(cause, deepFreeze({
            ...snapshot(),
            status: state.status,
            failedUseId: useState.useId,
            failedUse: record,
            cleanup,
          }));
        },
      );
    }

    return Object.freeze({
      schema: WEBGPU_SCRATCH_ARENA_USE_SCHEMA,
      arenaId: input.arenaId,
      useId: useState.useId,
      useSequence: useState.useSequence,
      resource,
      abandon,
      markSubmitted,
    });
  }

  function close(options = {}) {
    if (state.status === 'closed') {
      return deepFreeze({
        schema: WEBGPU_SCRATCH_ARENA_SCHEMA,
        arenaId: input.arenaId,
        status: 'already-closed',
        disposedSlotIds: [],
      });
    }
    if (state.status === 'invalidated') {
      return deepFreeze({
        schema: WEBGPU_SCRATCH_ARENA_SCHEMA,
        arenaId: input.arenaId,
        status: 'already-invalidated',
        disposedSlotIds: [],
      });
    }
    if (state.status === 'dispose-failed') {
      throw errorWithReport(new Error('scratch arena disposal previously failed'), snapshot());
    }
    if (state.activeUse?.status === 'submitted') {
      throw errorWithReport(
        new Error(`scratch arena submitted use is pending: ${state.activeUse.useId}`),
        snapshot(),
      );
    }
    if (state.activeUse?.status === 'active') {
      state.activeUse.status = 'abandoned';
      finalizeUse(state.activeUse, 'abandoned', {
        reason: options.reason ?? 'arena-closed-before-submit',
      });
    }
    const cleanup = disposeAllocations(allocations, options.reason ?? 'arena-close');
    state.status = cleanup.status === 'disposed' ? 'closed' : 'dispose-failed';
    state.closedAtMs = now();
    state.terminalReason = options.reason ?? null;
    const report = deepFreeze({
      ...snapshot(),
      disposedSlotIds: cleanup.disposedSlotIds,
      cleanup,
    });
    if (state.status === 'dispose-failed') {
      throw errorWithReport(new Error('scratch arena could not dispose every slot'), report);
    }
    return report;
  }

  return Object.freeze({
    schema: WEBGPU_SCRATCH_ARENA_SCHEMA,
    arenaId: input.arenaId,
    slots: normalized.slots,
    beginUse,
    snapshot,
    close,
    destroy: close,
  });
}
