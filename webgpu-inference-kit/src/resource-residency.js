export const WEBGPU_RESOURCE_RESIDENCY_SCHEMA = 'kaminos.webgpu-resource-residency.v0';
export const WEBGPU_RESOURCE_RESIDENCY_RESOURCE_SCHEMA = 'kaminos.webgpu-resource-residency-resource.v0';
export const WEBGPU_RESOURCE_RESIDENCY_LEASE_SCHEMA = 'kaminos.webgpu-resource-residency-lease.v0';
export const WEBGPU_RESOURCE_RESIDENCY_INVALIDATION_SCHEMA = 'kaminos.webgpu-resource-residency-invalidation.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneJson(value, label) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error(`${label} must be JSON-compatible`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value != null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareText(left, right) {
  return left.localeCompare(right);
}

function isResourceObject(value) {
  return value != null && (typeof value === 'object' || typeof value === 'function');
}

function disposeManagedResource(resource) {
  const result = resource.dispose(resource.value);
  if (result != null && typeof result.then === 'function') {
    throw new Error('managed resource disposer must complete synchronously');
  }
}

export function createWebGpuResourceResidency(input = {}) {
  if (!isNonEmptyString(input.sessionId)) throw new Error('sessionId must be a non-empty string');
  if (
    input.maxBytes != null
    || input.memoryLimit != null
    || input.resourceLimit != null
    || input.retentionLimit != null
  ) {
    throw new Error('resource residency does not impose a memory cap; caller policy must remain explicit and accounting is uncapped');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  if (typeof now !== 'function') throw new Error('now must be a function');

  const state = {
    status: 'active',
    invalidation: null,
    resources: new Map(),
    leases: new Map(),
    routeIds: new Set(),
    nextLeaseSequence: 1,
  };

  function assertActive() {
    if (state.status !== 'active') {
      throw new Error(`resource residency for session ${input.sessionId} is invalidated: ${state.invalidation?.reason || 'unknown'}`);
    }
  }

  function descriptorFrom(acquireInput) {
    if (!isNonEmptyString(acquireInput.resourceId)) throw new Error('resourceId must be a non-empty string');
    if (!isNonEmptyString(acquireInput.routeId)) throw new Error('routeId must be a non-empty string');
    if (!Number.isSafeInteger(acquireInput.declaredBytes) || acquireInput.declaredBytes < 0) {
      throw new Error('declaredBytes must be a non-negative safe integer');
    }
    const kind = acquireInput.kind == null ? 'other' : acquireInput.kind;
    if (!isNonEmptyString(kind)) throw new Error('kind must be a non-empty string');
    const ownership = acquireInput.ownership == null ? 'borrowed' : acquireInput.ownership;
    if (ownership !== 'borrowed' && ownership !== 'managed') {
      throw new Error('ownership must be borrowed or managed');
    }
    const metadata = cloneJson(acquireInput.metadata ?? null, 'metadata');
    return {
      resourceId: acquireInput.resourceId,
      declaredBytes: acquireInput.declaredBytes,
      kind,
      ownership,
      metadata,
      fingerprint: canonicalJson({ declaredBytes: acquireInput.declaredBytes, kind, ownership, metadata }),
    };
  }

  function resourceSnapshot(resource) {
    const owners = [...resource.routeLeaseCounts.entries()]
      .map(([routeId, activeLeaseCount]) => ({ routeId, activeLeaseCount }))
      .sort((left, right) => compareText(left.routeId, right.routeId));
    return {
      schema: WEBGPU_RESOURCE_RESIDENCY_RESOURCE_SCHEMA,
      resourceId: resource.resourceId,
      status: resource.status,
      generation: resource.generation,
      declaredBytes: resource.declaredBytes,
      accountingAuthority: 'caller-declared-allocation-bytes-not-browser-global-vram',
      kind: resource.kind,
      ownership: resource.ownership,
      liveResource: resource.value == null ? 'absent' : 'present-not-serialized',
      metadata: cloneJson(resource.metadata, 'metadata'),
      activeLeaseCount: resource.leases.size,
      owners,
      createdAtMs: resource.createdAtMs,
      lastAcquiredAtMs: resource.lastAcquiredAtMs,
      lastReleasedAtMs: resource.lastReleasedAtMs,
      evictedAtMs: resource.evictedAtMs,
      invalidatedAtMs: resource.invalidatedAtMs,
    };
  }

  function routeSnapshot(routeId) {
    const resources = [...state.resources.values()]
      .filter(resource => resource.routeParticipation.has(routeId))
      .map(resource => ({
        resourceId: resource.resourceId,
        generation: resource.routeParticipation.get(routeId).generation,
        declaredBytes: resource.declaredBytes,
        activeLeaseCount: resource.routeLeaseCounts.get(routeId) || 0,
      }))
      .sort((left, right) => compareText(left.resourceId, right.resourceId));
    return {
      routeId,
      activeLeaseCount: resources.reduce((sum, resource) => sum + resource.activeLeaseCount, 0),
      leasedDeclaredBytes: resources.reduce(
        (sum, resource) => sum + (resource.activeLeaseCount > 0 ? resource.declaredBytes : 0),
        0,
      ),
      resources,
    };
  }

  function snapshot() {
    const resources = [...state.resources.values()].map(resourceSnapshot);
    const evictionCandidates = resources
      .filter(resource => resource.status === 'resident' && resource.activeLeaseCount === 0)
      .sort((left, right) => {
        const leftAt = left.lastReleasedAtMs ?? left.createdAtMs;
        const rightAt = right.lastReleasedAtMs ?? right.createdAtMs;
        return leftAt - rightAt || compareText(left.resourceId, right.resourceId);
      })
      .map(resource => ({
        resourceId: resource.resourceId,
        generation: resource.generation,
        declaredBytes: resource.declaredBytes,
        kind: resource.kind,
        ownership: resource.ownership,
        eligibleBecause: 'resident-without-active-leases',
        lastReleasedAtMs: resource.lastReleasedAtMs,
      }));
    return {
      schema: WEBGPU_RESOURCE_RESIDENCY_SCHEMA,
      sessionId: input.sessionId,
      status: state.status,
      accountingAuthority: 'caller-declared-allocation-bytes-not-browser-global-vram',
      evictionAuthority: 'advisory-candidates-only-caller-must-evict-and-dispose-resource',
      retention: 'uncapped-until-explicit-forget',
      totalResidentDeclaredBytes: resources
        .filter(resource => resource.status === 'resident')
        .reduce((sum, resource) => sum + resource.declaredBytes, 0),
      activeLeaseCount: state.leases.size,
      invalidation: cloneJson(state.invalidation, 'invalidation'),
      routes: [...state.routeIds].sort(compareText).map(routeSnapshot),
      evictionCandidates,
      resources,
    };
  }

  function acquire(acquireInput = {}) {
    assertActive();
    const descriptor = descriptorFrom(acquireInput);
    let resource = state.resources.get(descriptor.resourceId);
    const acquiredAtMs = now();
    if (resource && resource.fingerprint !== descriptor.fingerprint) {
      throw new Error(`conflicting descriptor for resource identity ${descriptor.resourceId}`);
    }
    if (!resource) {
      if (!isResourceObject(acquireInput.resource)) {
        throw new Error(`first acquisition of resource ${descriptor.resourceId} requires the live resource object`);
      }
      if (descriptor.ownership === 'managed' && typeof acquireInput.dispose !== 'function' && typeof acquireInput.resource.destroy !== 'function') {
        throw new Error(`managed resource ${descriptor.resourceId} requires dispose(resource) or resource.destroy()`);
      }
      if (descriptor.ownership === 'borrowed' && acquireInput.dispose != null) {
        throw new Error(`borrowed resource ${descriptor.resourceId} cannot declare a managed disposer`);
      }
      resource = {
        ...descriptor,
        value: acquireInput.resource,
        dispose: descriptor.ownership === 'managed'
          ? (acquireInput.dispose || (value => value.destroy()))
          : null,
        status: 'resident',
        generation: 1,
        leases: new Map(),
        routeLeaseCounts: new Map(),
        routeParticipation: new Map(),
        createdAtMs: acquiredAtMs,
        lastAcquiredAtMs: acquiredAtMs,
        lastReleasedAtMs: null,
        evictedAtMs: null,
        invalidatedAtMs: null,
      };
      state.resources.set(resource.resourceId, resource);
    } else if (resource.status === 'evicted') {
      if (!isResourceObject(acquireInput.resource)) {
        throw new Error(`reacquisition of evicted resource ${descriptor.resourceId} requires a new live resource object`);
      }
      resource.status = 'resident';
      resource.value = acquireInput.resource;
      if (resource.ownership === 'managed' && acquireInput.dispose != null) {
        if (typeof acquireInput.dispose !== 'function') throw new Error('dispose must be a function');
        resource.dispose = acquireInput.dispose;
      }
      resource.generation += 1;
      resource.lastAcquiredAtMs = acquiredAtMs;
      resource.lastReleasedAtMs = null;
      resource.evictedAtMs = null;
    } else {
      if (acquireInput.resource != null && acquireInput.resource !== resource.value) {
        throw new Error(`resource identity ${descriptor.resourceId} is already resident with a different live resource object`);
      }
      resource.lastAcquiredAtMs = acquiredAtMs;
    }

    const leaseId = `${input.sessionId}:resource-lease:${state.nextLeaseSequence}`;
    state.nextLeaseSequence += 1;
    const lease = {
      leaseId,
      resourceId: resource.resourceId,
      routeId: acquireInput.routeId,
      generation: resource.generation,
      acquiredAtMs,
      released: false,
      invalidated: false,
    };
    state.routeIds.add(lease.routeId);
    resource.routeParticipation.set(lease.routeId, { generation: resource.generation });
    state.leases.set(leaseId, lease);
    resource.leases.set(leaseId, lease);
    resource.routeLeaseCounts.set(lease.routeId, (resource.routeLeaseCounts.get(lease.routeId) || 0) + 1);

    function release() {
      if (lease.invalidated) {
        return deepFreeze({
          schema: WEBGPU_RESOURCE_RESIDENCY_LEASE_SCHEMA,
          leaseId,
          resourceId: lease.resourceId,
          routeId: lease.routeId,
          generation: lease.generation,
          status: 'invalidated',
          invalidation: cloneJson(state.invalidation, 'invalidation'),
        });
      }
      if (lease.released) {
        return deepFreeze({
          schema: WEBGPU_RESOURCE_RESIDENCY_LEASE_SCHEMA,
          leaseId,
          resourceId: lease.resourceId,
          routeId: lease.routeId,
          generation: lease.generation,
          status: 'already-released',
        });
      }
      lease.released = true;
      state.leases.delete(leaseId);
      resource.leases.delete(leaseId);
      const routeLeaseCount = resource.routeLeaseCounts.get(lease.routeId) - 1;
      if (routeLeaseCount === 0) resource.routeLeaseCounts.delete(lease.routeId);
      else resource.routeLeaseCounts.set(lease.routeId, routeLeaseCount);
      resource.lastReleasedAtMs = now();
      return deepFreeze({
        schema: WEBGPU_RESOURCE_RESIDENCY_LEASE_SCHEMA,
        leaseId,
        resourceId: lease.resourceId,
        routeId: lease.routeId,
        generation: lease.generation,
        status: 'released',
        releasedAtMs: resource.lastReleasedAtMs,
      });
    }

    return Object.freeze({
      schema: WEBGPU_RESOURCE_RESIDENCY_LEASE_SCHEMA,
      leaseId,
      resourceId: lease.resourceId,
      routeId: lease.routeId,
      generation: lease.generation,
      declaredBytes: resource.declaredBytes,
      kind: resource.kind,
      resource: resource.value,
      release,
    });
  }

  function evict(resourceId) {
    assertActive();
    const resource = state.resources.get(resourceId);
    if (!resource) throw new Error(`unknown resource ${resourceId || '<missing>'}`);
    if (resource.status === 'evicted') {
      return deepFreeze({ resourceId, generation: resource.generation, status: 'already-evicted' });
    }
    if (resource.leases.size > 0) {
      throw new Error(`resource ${resourceId} has ${resource.leases.size} active lease(s) and cannot be evicted`);
    }
    if (resource.ownership === 'managed') disposeManagedResource(resource);
    resource.status = 'evicted';
    resource.value = null;
    resource.evictedAtMs = now();
    return deepFreeze({
      resourceId,
      generation: resource.generation,
      declaredBytes: resource.declaredBytes,
      status: 'evicted',
      evictedAtMs: resource.evictedAtMs,
      disposalAuthority: 'caller-must-dispose-underlying-gpu-resource',
    });
  }

  function forget(resourceId) {
    assertActive();
    const resource = state.resources.get(resourceId);
    if (!resource) return false;
    if (resource.status === 'resident' || resource.leases.size > 0) {
      throw new Error(`resource ${resourceId} must be evicted and unleased before forget`);
    }
    const forgotten = state.resources.delete(resourceId);
    for (const routeId of state.routeIds) {
      const retained = [...state.resources.values()].some(candidate => candidate.routeParticipation.has(routeId));
      if (!retained) state.routeIds.delete(routeId);
    }
    return forgotten;
  }

  function invalidateAll(invalidationInput = {}) {
    if (state.invalidation) return state.invalidation;
    const reason = isNonEmptyString(invalidationInput.reason) ? invalidationInput.reason : 'unknown';
    const invalidatedAtMs = now();
    const managedDisposal = {
      attemptedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      failures: [],
    };
    if (invalidationInput.disposeManaged === true) {
      for (const resource of state.resources.values()) {
        if (resource.status === 'resident' && resource.ownership === 'managed') {
          managedDisposal.attemptedCount += 1;
          try {
            disposeManagedResource(resource);
            managedDisposal.succeededCount += 1;
          } catch (error) {
            managedDisposal.failedCount += 1;
            managedDisposal.failures.push({
              resourceId: resource.resourceId,
              generation: resource.generation,
              message: String(error?.message || error),
            });
          }
        }
      }
    }
    state.status = 'invalidated';
    state.invalidation = deepFreeze({
      schema: WEBGPU_RESOURCE_RESIDENCY_INVALIDATION_SCHEMA,
      sessionId: input.sessionId,
      reason,
      message: typeof invalidationInput.message === 'string' ? invalidationInput.message : '',
      invalidatedAtMs,
      resourceAuthority: 'ledger-invalidated-underlying-resource-disposal-remains-caller-or-device-owned',
      managedDisposal,
    });
    for (const lease of state.leases.values()) {
      lease.invalidated = true;
      lease.released = true;
    }
    state.leases.clear();
    for (const resource of state.resources.values()) {
      resource.status = 'invalidated';
      resource.value = null;
      resource.invalidatedAtMs = invalidatedAtMs;
      resource.leases.clear();
      resource.routeLeaseCounts.clear();
      resource.routeParticipation.clear();
    }
    state.routeIds.clear();
    return state.invalidation;
  }

  return Object.freeze({
    sessionId: input.sessionId,
    acquire,
    evict,
    forget,
    invalidateAll,
    hasActiveLeases(routeId) {
      if (routeId == null) return state.leases.size > 0;
      for (const lease of state.leases.values()) {
        if (lease.routeId === routeId) return true;
      }
      return false;
    },
    routeSnapshot(routeId) { return deepFreeze(routeSnapshot(routeId)); },
    snapshot() { return deepFreeze(snapshot()); },
  });
}
