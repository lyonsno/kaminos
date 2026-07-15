export const WEBGPU_RESOURCE_FACTORY_SCHEMA = 'kaminos.webgpu-resource-factory.v0';
export const WEBGPU_RESOURCE_FLIGHT_SCHEMA = 'kaminos.webgpu-resource-flight.v0';

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

function abortError(reason) {
  const message = reason == null ? 'resource request aborted' : `resource request aborted: ${String(reason)}`;
  return new DOMException(message, 'AbortError');
}

export function createWebGpuResourceFactory(input = {}) {
  if (!isNonEmptyString(input.sessionId)) throw new Error('sessionId must be a non-empty string');
  if (!input.residency || typeof input.residency.acquire !== 'function' || typeof input.residency.snapshot !== 'function') {
    throw new Error('residency must expose acquire and snapshot');
  }
  if (input.flightLimit != null || input.retentionLimit != null) {
    throw new Error('resource factory flight retention is uncapped until explicit forgetFlight');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const flights = [];
  const activeByResource = new Map();
  let nextFlightSequence = 1;
  let nextWaiterSequence = 1;
  let invalidation = null;

  function descriptor(request) {
    if (!isNonEmptyString(request.resourceId)) throw new Error('resourceId must be a non-empty string');
    if (!isNonEmptyString(request.routeId)) throw new Error('routeId must be a non-empty string');
    if (!Number.isSafeInteger(request.declaredBytes) || request.declaredBytes < 0) {
      throw new Error('declaredBytes must be a non-negative safe integer');
    }
    const kind = request.kind ?? 'other';
    if (!isNonEmptyString(kind)) throw new Error('kind must be a non-empty string');
    const metadata = cloneJson(request.metadata ?? null, 'metadata');
    return {
      resourceId: request.resourceId,
      declaredBytes: request.declaredBytes,
      kind,
      metadata,
      fingerprint: canonicalJson({ declaredBytes: request.declaredBytes, kind, ownership: 'managed', metadata }),
    };
  }

  function flightSnapshot(flight) {
    return {
      schema: WEBGPU_RESOURCE_FLIGHT_SCHEMA,
      flightId: flight.flightId,
      resourceId: flight.resourceId,
      generation: flight.generation,
      status: flight.status,
      declaredBytes: flight.declaredBytes,
      kind: flight.kind,
      metadata: cloneJson(flight.metadata, 'metadata'),
      waiterCount: flight.waiters.size,
      requestedWaiterCount: flight.requestedWaiterCount,
      cancelledWaiterCount: flight.cancelledWaiterCount,
      routeIds: [...flight.routeIds].sort(),
      createdAtMs: flight.createdAtMs,
      settledAtMs: flight.settledAtMs,
      failure: cloneJson(flight.failure, 'failure'),
    };
  }

  function snapshot() {
    return {
      schema: WEBGPU_RESOURCE_FACTORY_SCHEMA,
      sessionId: input.sessionId,
      status: invalidation ? 'invalidated' : 'active',
      retention: 'uncapped-until-explicit-forget-flight',
      activeFlightCount: activeByResource.size,
      invalidation: cloneJson(invalidation, 'invalidation'),
      flights: flights.map(flightSnapshot),
    };
  }

  function addWaiter(flight, request) {
    const waiterId = `${flight.flightId}:waiter:${nextWaiterSequence++}`;
    flight.requestedWaiterCount += 1;
    flight.routeIds.add(request.routeId);
    return new Promise((resolve, reject) => {
      const waiter = { waiterId, request, resolve, reject, abortListener: null };
      function cancel() {
        if (!flight.waiters.delete(waiterId)) return;
        flight.cancelledWaiterCount += 1;
        request.signal?.removeEventListener('abort', waiter.abortListener);
        reject(abortError(request.signal?.reason));
        if (flight.waiters.size === 0 && flight.status === 'active') {
          flight.controller.abort('all-resource-waiters-cancelled');
        }
      }
      waiter.abortListener = cancel;
      if (request.signal?.aborted) {
        reject(abortError(request.signal.reason));
        flight.cancelledWaiterCount += 1;
        if (flight.waiters.size === 0) flight.controller.abort('all-resource-waiters-cancelled');
        return;
      }
      flight.waiters.set(waiterId, waiter);
      request.signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  function settleWaiters(flight, action) {
    const waiters = [...flight.waiters.values()];
    flight.waiters.clear();
    for (const waiter of waiters) {
      waiter.request.signal?.removeEventListener('abort', waiter.abortListener);
      action(waiter);
    }
  }

  function startFlight(flight, request) {
    flight.task = Promise.resolve()
      .then(() => request.create({
        signal: flight.controller.signal,
        flightId: flight.flightId,
        resourceId: flight.resourceId,
        generation: flight.generation,
      }))
      .then(resource => {
        if (invalidation || flight.waiters.size === 0) {
          flight.status = invalidation ? 'invalidated' : 'cancelled';
          if (!invalidation) request.dispose(resource);
          return;
        }
        let first = true;
        settleWaiters(flight, waiter => {
          try {
            waiter.resolve(input.residency.acquire({
              resourceId: flight.resourceId,
              routeId: waiter.request.routeId,
              declaredBytes: flight.declaredBytes,
              kind: flight.kind,
              metadata: flight.metadata,
              ownership: 'managed',
              ...(first ? { resource, dispose: request.dispose } : {}),
            }));
            first = false;
          } catch (error) {
            waiter.reject(error);
          }
        });
        flight.status = 'succeeded';
      }, error => {
        flight.failure = { name: String(error?.name || 'Error'), message: String(error?.message || error) };
        flight.status = flight.waiters.size === 0 ? 'cancelled' : (invalidation ? 'invalidated' : 'failed');
        settleWaiters(flight, waiter => waiter.reject(error));
      })
      .finally(() => {
        flight.settledAtMs = now();
        activeByResource.delete(flight.resourceId);
      });
  }

  function acquireOrCreate(request = {}) {
    if (invalidation) return Promise.reject(new Error(`resource factory invalidated: ${invalidation.reason}`));
    const normalized = descriptor(request);
    const resident = input.residency.snapshot().resources.find(resource => resource.resourceId === normalized.resourceId && resource.status === 'resident');
    if (resident) {
      return Promise.resolve(input.residency.acquire({
        ...normalized,
        routeId: request.routeId,
        ownership: 'managed',
      }));
    }
    let flight = activeByResource.get(normalized.resourceId);
    if (flight) {
      if (flight.fingerprint !== normalized.fingerprint) {
        return Promise.reject(new Error(`conflicting descriptor for active resource flight ${normalized.resourceId}`));
      }
      return addWaiter(flight, request);
    }
    if (typeof request.create !== 'function') return Promise.reject(new Error('create must be a function for an absent resource'));
    if (typeof request.dispose !== 'function') return Promise.reject(new Error('dispose must be a synchronous function for a managed resource'));
    const previous = flights.filter(candidate => candidate.resourceId === normalized.resourceId).at(-1);
    flight = {
      ...normalized,
      flightId: `${input.sessionId}:resource-flight:${nextFlightSequence++}`,
      generation: (previous?.generation || 0) + 1,
      status: 'active',
      waiters: new Map(),
      requestedWaiterCount: 0,
      cancelledWaiterCount: 0,
      controller: new AbortController(),
      routeIds: new Set([request.routeId]),
      createdAtMs: now(),
      settledAtMs: null,
      failure: null,
      task: null,
    };
    flights.push(flight);
    activeByResource.set(flight.resourceId, flight);
    const promise = addWaiter(flight, request);
    startFlight(flight, request);
    return promise;
  }

  return Object.freeze({
    sessionId: input.sessionId,
    acquireOrCreate,
    forgetFlight(flightId) {
      const index = flights.findIndex(flight => flight.flightId === flightId);
      if (index < 0) return false;
      if (flights[index].status === 'active') throw new Error('cannot forget an active resource flight');
      flights.splice(index, 1);
      return true;
    },
    invalidateAll(reason = 'unknown') {
      if (invalidation) return invalidation;
      invalidation = deepFreeze({ reason, atMs: now() });
      for (const flight of activeByResource.values()) {
        flight.controller.abort(reason);
        flight.status = 'invalidated';
        settleWaiters(flight, waiter => waiter.reject(new Error(`resource factory invalidated: ${reason}`)));
      }
      return invalidation;
    },
    hasActiveFlights(routeId) {
      for (const flight of activeByResource.values()) {
        if (flight.routeIds.has(routeId)) return true;
      }
      return false;
    },
    async drain() { await Promise.all([...activeByResource.values()].map(flight => flight.task)); return deepFreeze(snapshot()); },
    snapshot() { return deepFreeze(snapshot()); },
  });
}
