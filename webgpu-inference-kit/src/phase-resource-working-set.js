export const WEBGPU_PHASE_RESOURCE_PLAN_SCHEMA = 'kaminos.webgpu-phase-resource-plan.v0';
export const WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA = 'kaminos.webgpu-phase-resource-working-set.v0';
export const WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA = 'kaminos.webgpu-phase-resource-transition.v0';

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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value != null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedResourceIds(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const ids = [];
  const seen = new Set();
  for (const resourceId of value) {
    if (!isNonEmptyString(resourceId)) throw new Error(`${label} entries must be non-empty strings`);
    if (seen.has(resourceId)) throw new Error(`${label} contains duplicate resource ${resourceId}`);
    seen.add(resourceId);
    ids.push(resourceId);
  }
  return ids;
}

function sumDeclaredBytes(resources) {
  let total = 0;
  for (const resource of resources) {
    total += resource.declaredBytes;
    if (!Number.isSafeInteger(total)) throw new Error('phase resource declared bytes exceed the safe integer range');
  }
  return total;
}

export function defineWebGpuPhaseResourcePlan(input = {}) {
  if (
    input.maxResources != null
    || input.maxPhases != null
    || input.maxDeclaredBytes != null
    || input.retentionLimit != null
  ) {
    throw new Error('phase resource plans are uncapped; maxResources, maxPhases, maxDeclaredBytes, and retentionLimit are not supported');
  }
  if (!isNonEmptyString(input.planId)) throw new Error('phase resource planId must be a non-empty string');
  if (!Array.isArray(input.resources) || input.resources.length === 0) {
    throw new Error('phase resource plan resources must be a non-empty array');
  }
  if (!Array.isArray(input.phases) || input.phases.length === 0) {
    throw new Error('phase resource plan phases must be a non-empty array');
  }

  const resourceIds = new Set();
  const resources = input.resources.map((resource, index) => {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      throw new Error(`phase resource plan resources[${index}] must be an object`);
    }
    if (!isNonEmptyString(resource.resourceId)) {
      throw new Error(`phase resource plan resources[${index}].resourceId must be a non-empty string`);
    }
    if (resourceIds.has(resource.resourceId)) {
      throw new Error(`duplicate phase resource ${resource.resourceId}`);
    }
    if (!Number.isSafeInteger(resource.declaredBytes) || resource.declaredBytes < 0) {
      throw new Error(`phase resource ${resource.resourceId} declaredBytes must be a non-negative safe integer`);
    }
    resourceIds.add(resource.resourceId);
    return {
      resourceId: resource.resourceId,
      declaredBytes: resource.declaredBytes,
      metadata: cloneJson(resource.metadata ?? null, `phase resource ${resource.resourceId} metadata`),
    };
  });

  const phaseIds = new Set();
  const phases = input.phases.map((phase, index) => {
    if (!phase || typeof phase !== 'object' || Array.isArray(phase)) {
      throw new Error(`phase resource plan phases[${index}] must be an object`);
    }
    if (!isNonEmptyString(phase.phaseId)) {
      throw new Error(`phase resource plan phases[${index}].phaseId must be a non-empty string`);
    }
    if (phaseIds.has(phase.phaseId)) throw new Error(`duplicate phase ${phase.phaseId}`);
    phaseIds.add(phase.phaseId);
    const requiredResourceIds = normalizedResourceIds(
      phase.requiredResourceIds,
      `phase ${phase.phaseId} requiredResourceIds`,
    );
    const prefetchResourceIds = normalizedResourceIds(
      phase.prefetchResourceIds,
      `phase ${phase.phaseId} prefetchResourceIds`,
    );
    for (const resourceId of [...requiredResourceIds, ...prefetchResourceIds]) {
      if (!resourceIds.has(resourceId)) {
        throw new Error(`phase ${phase.phaseId} references unknown resource ${resourceId}`);
      }
    }
    const holdResourceIds = [...requiredResourceIds];
    const held = new Set(holdResourceIds);
    for (const resourceId of prefetchResourceIds) {
      if (!held.has(resourceId)) {
        held.add(resourceId);
        holdResourceIds.push(resourceId);
      }
    }
    return {
      phaseId: phase.phaseId,
      requiredResourceIds,
      prefetchResourceIds,
      holdResourceIds,
      metadata: cloneJson(phase.metadata ?? null, `phase ${phase.phaseId} metadata`),
    };
  });

  const identityInput = {
    planId: input.planId,
    resources,
    phases,
    metadata: cloneJson(input.metadata ?? null, 'phase resource plan metadata'),
  };
  const plan = {
    schema: WEBGPU_PHASE_RESOURCE_PLAN_SCHEMA,
    ...identityInput,
    resourceIds: resources.map(resource => resource.resourceId),
    phaseIds: phases.map(phase => phase.phaseId),
    totalDeclaredBytes: sumDeclaredBytes(resources),
    identity: `${encodeURIComponent(input.planId)}#${encodeURIComponent(canonicalJson(identityInput))}`,
  };
  return deepFreeze(plan);
}

function abortError(signal) {
  const error = new Error(String(signal?.reason || 'phase resource transition aborted'));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function errorWithWorkingSetReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!Object.hasOwn(error, 'workingSetReport')) {
    try {
      error.workingSetReport = report;
      if (error.workingSetReport === report) return error;
    } catch {}
  }
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.workingSetReport = report;
  return wrapped;
}

function releaseLease(entry) {
  const result = entry.lease.release();
  if (result != null && typeof result.then === 'function') {
    throw new Error(`phase resource ${entry.resource.resourceId} lease release must complete synchronously`);
  }
  const releaseStatus = result?.status ?? 'released';
  if (releaseStatus === 'release-failed') {
    throw new Error(`phase resource ${entry.resource.resourceId} lease release failed`);
  }
  if (releaseStatus === 'invalidated') {
    return { outcome: 'invalidated', releaseStatus };
  }
  if (releaseStatus !== 'released' && releaseStatus !== 'already-released') {
    throw new Error(
      `phase resource ${entry.resource.resourceId} lease release returned unsupported status ${releaseStatus}`,
    );
  }
  return { outcome: 'released', releaseStatus };
}

function cleanupEntries(entries) {
  const releasedResourceIds = [];
  const invalidatedResourceIds = [];
  const releaseResults = [];
  const failures = [];
  for (const entry of [...entries].reverse()) {
    try {
      const release = releaseLease(entry);
      releaseResults.push({
        resourceId: entry.resource.resourceId,
        status: release.releaseStatus,
      });
      if (release.outcome === 'invalidated') {
        invalidatedResourceIds.push(entry.resource.resourceId);
      } else {
        releasedResourceIds.push(entry.resource.resourceId);
      }
    } catch (error) {
      failures.push({
        resourceId: entry.resource.resourceId,
        message: String(error?.message || error),
      });
    }
  }
  return deepFreeze({
    status: failures.length > 0
      ? 'release-failed'
      : (invalidatedResourceIds.length > 0 ? 'invalidated' : 'released'),
    releasedResourceIds,
    invalidatedResourceIds,
    releaseResults,
    failures,
  });
}

function failedReleaseResourceIds(cleanup) {
  return new Set(cleanup.failures.map(failure => failure.resourceId));
}

export function createWebGpuPhaseResourceWorkingSet(input = {}) {
  if (
    input.maxHeldResources != null
    || input.maxHeldBytes != null
    || input.maxTransitions != null
    || input.retentionLimit != null
  ) {
    throw new Error('phase resource working sets are uncapped; maxHeldResources, maxHeldBytes, maxTransitions, and retentionLimit are not supported');
  }
  if (!isNonEmptyString(input.controllerId)) throw new Error('phase resource controllerId must be a non-empty string');
  if (typeof input.acquireResource !== 'function') throw new Error('phase resource acquireResource must be a function');
  if (input.residencySnapshot != null && typeof input.residencySnapshot !== 'function') {
    throw new Error('phase resource residencySnapshot must be a function');
  }
  const plan = defineWebGpuPhaseResourcePlan(input.plan);
  const now = input.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  if (typeof now !== 'function') throw new Error('phase resource now must be a function');

  const resourceById = new Map(plan.resources.map(resource => [resource.resourceId, resource]));
  const phaseById = new Map(plan.phases.map(phase => [phase.phaseId, phase]));
  const state = {
    status: 'active',
    currentPhaseId: null,
    held: new Map(),
    transitionCount: 0,
    activeTransition: null,
    closedAtMs: null,
  };

  function readResidencyReport() {
    if (!input.residencySnapshot) return { residency: null, residencyError: null };
    try {
      return {
        residency: cloneJson(input.residencySnapshot(), 'phase resource residency snapshot'),
        residencyError: null,
      };
    } catch (error) {
      return {
        residency: null,
        residencyError: {
          name: error?.name || 'Error',
          message: String(error?.message || error),
        },
      };
    }
  }

  function heldResourceIds() {
    return [...state.held.keys()];
  }

  function heldDeclaredBytes() {
    return sumDeclaredBytes([...state.held.values()].map(entry => entry.resource));
  }

  function snapshot() {
    const residencyReport = readResidencyReport();
    return deepFreeze({
      schema: WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
      controllerId: input.controllerId,
      planIdentity: plan.identity,
      status: state.status,
      currentPhaseId: state.currentPhaseId,
      heldResourceIds: heldResourceIds(),
      heldDeclaredBytes: heldDeclaredBytes(),
      transitionCount: state.transitionCount,
      activeTransition: state.activeTransition ? { ...state.activeTransition } : null,
      ...residencyReport,
      closedAtMs: state.closedAtMs,
    });
  }

  async function transitionToPhase(phaseId, options = {}) {
    if (state.status !== 'active') throw new Error(`phase resource working set is ${state.status}`);
    if (state.activeTransition) throw new Error('phase resource transition is already in progress');
    const phase = phaseById.get(phaseId);
    if (!phase) throw new Error(`unknown phase resource phase ${phaseId || '<missing>'}`);
    throwIfAborted(options.signal);

    const startedAtMs = now();
    const fromPhaseId = state.currentPhaseId;
    const retainedResourceIds = phase.holdResourceIds.filter(resourceId => state.held.has(resourceId));
    const acquired = [];
    let failedResourceId = null;
    state.activeTransition = {
      fromPhaseId,
      toPhaseId: phaseId,
      startedAtMs,
    };

    try {
      for (const resourceId of phase.holdResourceIds) {
        if (state.held.has(resourceId)) continue;
        throwIfAborted(options.signal);
        failedResourceId = resourceId;
        const resource = resourceById.get(resourceId);
        const purpose = phase.requiredResourceIds.includes(resourceId) ? 'required' : 'prefetch';
        const lease = await input.acquireResource({
          controllerId: input.controllerId,
          plan,
          phaseId,
          purpose,
          resource,
          signal: options.signal,
        });
        if (!lease || typeof lease !== 'object' || typeof lease.release !== 'function') {
          throw new Error(`phase resource ${resourceId} acquisition must return a lease with release()`);
        }
        const entry = { resource, lease, purpose };
        acquired.push(entry);
        if (lease.resourceId != null && lease.resourceId !== resourceId) {
          throw new Error(`phase resource ${resourceId} acquisition returned lease for ${lease.resourceId}`);
        }
        throwIfAborted(options.signal);
      }

      const target = new Set(phase.holdResourceIds);
      const departed = [...state.held.values()].filter(entry => !target.has(entry.resource.resourceId));
      const release = cleanupEntries(departed);
      if (release.status === 'release-failed') {
        const acquiredCleanup = cleanupEntries(acquired);
        const settledDeparted = new Set([
          ...release.releasedResourceIds,
          ...release.invalidatedResourceIds,
        ]);
        const unresolvedAcquired = failedReleaseResourceIds(acquiredCleanup);
        const degradedHeld = new Map(
          [...state.held].filter(([resourceId]) => !settledDeparted.has(resourceId)),
        );
        for (const entry of acquired) {
          if (unresolvedAcquired.has(entry.resource.resourceId)) {
            degradedHeld.set(entry.resource.resourceId, entry);
          }
        }
        state.held = degradedHeld;
        state.currentPhaseId = null;
        state.status = 'release-failed';
        throw errorWithWorkingSetReport(new Error('phase resource transition could not release departed resources'), deepFreeze({
          schema: WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA,
          status: 'release-failed',
          controllerId: input.controllerId,
          planIdentity: plan.identity,
          fromPhaseId,
          toPhaseId: phaseId,
          startedAtMs,
          settledAtMs: now(),
          failedResourceId: null,
          failure: { name: 'Error', message: 'phase resource transition could not release departed resources' },
          acquiredResourceIds: acquired.map(entry => entry.resource.resourceId),
          retainedResourceIds,
          releasedResourceIds: release.releasedResourceIds,
          invalidatedResourceIds: release.invalidatedResourceIds,
          heldResourceIds: heldResourceIds(),
          heldDeclaredBytes: heldDeclaredBytes(),
          ...readResidencyReport(),
          cleanup: acquiredCleanup,
          releaseFailures: release.failures,
        }));
      }

      const nextHeld = new Map();
      for (const resourceId of phase.holdResourceIds) {
        const entry = state.held.get(resourceId)
          || acquired.find(candidate => candidate.resource.resourceId === resourceId);
        nextHeld.set(resourceId, entry);
      }
      state.held = nextHeld;
      state.currentPhaseId = phaseId;
      state.transitionCount += 1;
      failedResourceId = null;
      return deepFreeze({
        schema: WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA,
        status: release.status === 'invalidated' ? 'prepared-after-invalidation' : 'prepared',
        controllerId: input.controllerId,
        planIdentity: plan.identity,
        transitionSequence: state.transitionCount,
        fromPhaseId,
        toPhaseId: phaseId,
        startedAtMs,
        settledAtMs: now(),
        failedResourceId: null,
        failure: null,
        acquiredResourceIds: acquired.map(entry => entry.resource.resourceId),
        retainedResourceIds,
        releasedResourceIds: release.releasedResourceIds,
        invalidatedResourceIds: release.invalidatedResourceIds,
        heldResourceIds: heldResourceIds(),
        heldDeclaredBytes: heldDeclaredBytes(),
        ...readResidencyReport(),
        cleanup: null,
      });
    } catch (cause) {
      if (cause?.workingSetReport) throw cause;
      const cleanup = cleanupEntries(acquired);
      if (cleanup.status === 'release-failed') {
        const unresolvedAcquired = failedReleaseResourceIds(cleanup);
        for (const entry of acquired) {
          if (unresolvedAcquired.has(entry.resource.resourceId)) {
            state.held.set(entry.resource.resourceId, entry);
          }
        }
        state.currentPhaseId = null;
        state.status = 'release-failed';
      }
      const canceled = cause?.name === 'AbortError' || options.signal?.aborted === true;
      const error = canceled && cause?.name !== 'AbortError' ? abortError(options.signal) : cause;
      const report = deepFreeze({
        schema: WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA,
        status: canceled ? 'canceled' : 'failed',
        controllerId: input.controllerId,
        planIdentity: plan.identity,
        transitionSequence: state.transitionCount + 1,
        fromPhaseId,
        toPhaseId: phaseId,
        startedAtMs,
        settledAtMs: now(),
        failedResourceId,
        failure: { name: error?.name || 'Error', message: String(error?.message || error) },
        acquiredResourceIds: acquired.map(entry => entry.resource.resourceId),
        retainedResourceIds,
        releasedResourceIds: [],
        invalidatedResourceIds: cleanup.invalidatedResourceIds,
        heldResourceIds: heldResourceIds(),
        heldDeclaredBytes: heldDeclaredBytes(),
        ...readResidencyReport(),
        cleanup,
        workingSetStatus: state.status,
      });
      throw errorWithWorkingSetReport(error, report);
    } finally {
      state.activeTransition = null;
    }
  }

  function close() {
    if (state.activeTransition) throw new Error('phase resource working set cannot close during an active transition');
    if (state.status === 'closed' || state.status === 'closed-after-invalidation') {
      return deepFreeze({
        schema: WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
        controllerId: input.controllerId,
        status: 'already-closed',
        releasedResourceIds: [],
      });
    }
    const cleanup = cleanupEntries([...state.held.values()]);
    const unresolved = failedReleaseResourceIds(cleanup);
    state.held = new Map(
      [...state.held].filter(([resourceId]) => unresolved.has(resourceId)),
    );
    state.currentPhaseId = null;
    state.status = cleanup.status === 'release-failed'
      ? 'close-failed'
      : (cleanup.status === 'invalidated' ? 'closed-after-invalidation' : 'closed');
    state.closedAtMs = now();
    return deepFreeze({
      schema: WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
      controllerId: input.controllerId,
      status: state.status,
      releasedResourceIds: cleanup.releasedResourceIds,
      invalidatedResourceIds: cleanup.invalidatedResourceIds,
      failures: cleanup.failures,
      heldResourceIds: heldResourceIds(),
      heldDeclaredBytes: heldDeclaredBytes(),
      ...readResidencyReport(),
      closedAtMs: state.closedAtMs,
    });
  }

  return Object.freeze({
    schema: WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
    controllerId: input.controllerId,
    plan,
    transitionToPhase,
    snapshot,
    close,
  });
}
