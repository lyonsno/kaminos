import {
  createWebGpuBackendIdentity,
  requestBrowserWebGpuDevice,
} from './gpu-environment.js';
import {
  createWebGpuInferenceCoordinator,
} from './inference-coordinator.js';
import {
  createWebGpuInferenceRuntime,
} from './inference-runtime.js';
import {
  createWebGpuResourceResidency,
} from './resource-residency.js';
import {
  createWebGpuResourceFactory,
} from './resource-factory.js';
import {
  loadWebGpuModelResources,
} from './model-resource-manifest.js';

export const WEBGPU_INFERENCE_SESSION_SCHEMA = 'kaminos.webgpu-inference-session.v0';
export const WEBGPU_INFERENCE_SESSION_DEVICE_LOSS_SCHEMA = 'kaminos.webgpu-inference-session-device-loss.v0';
export const WEBGPU_INFERENCE_SESSION_ROUTE_SCHEMA = 'kaminos.webgpu-inference-session-route.v0';

const RESERVED_RUNTIME_OPTIONS = [
  'routeId',
  'gpu',
  'adapter',
  'device',
  'queue',
  'deviceRequest',
  'backendIdentity',
  'admissionCoordinator',
];
const RESERVED_QUEUE_OPTIONS = ['routeId', 'runtime', 'admissionCoordinator'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNoReservedOptions(options, reserved, label) {
  for (const key of reserved) {
    if (Object.hasOwn(options, key)) throw new Error(`session owns ${key}; ${label} cannot override it`);
  }
}

export async function createWebGpuInferenceSession(input = {}) {
  if (!isNonEmptyString(input.sessionId)) throw new Error('sessionId must be a non-empty string');
  if (input.residency != null) throw new Error('session owns resource residency; callers cannot override it');
  if (input.maxRoutes != null || input.routeLimit != null || input.retentionLimit != null) {
    throw new Error('the inference session does not impose a hidden route cap; retention is uncapped until explicit unregister');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  if (typeof now !== 'function') throw new Error('now must be a function');

  let context;
  let deviceOwnership;
  if (input.device) {
    if (input.backendIdentity == null && !isNonEmptyString(input.adapterName)) {
      throw new Error('adapter identity required for a borrowed device; provide backendIdentity or adapterName');
    }
    if (input.backendIdentity != null && input.backendIdentity.kind !== 'webgpu-local') {
      throw new Error('backendIdentity must describe webgpu-local execution');
    }
    const device = input.device;
    context = {
      adapter: input.adapter || null,
      device,
      queue: input.queue || device.queue,
      deviceRequest: input.deviceRequest || null,
      backendIdentity: input.backendIdentity || createWebGpuBackendIdentity({
        adapterName: input.adapterName,
        browser: input.browser || globalThis.navigator?.userAgent || null,
        requestedFeatures: input.requestedFeatures || [],
        effectiveFeatures: input.effectiveFeatures || device.features || [],
        limits: input.limits || device.limits || {},
        timestampQuery: input.timestampQuery || 'unavailable',
      }),
    };
    deviceOwnership = input.deviceOwnership || 'borrowed';
  } else if (input.gpu) {
    const requested = await requestBrowserWebGpuDevice(input.gpu, input.deviceOptions || input);
    context = {
      ...requested,
      queue: input.queue || requested.device.queue,
    };
    deviceOwnership = input.deviceOwnership || 'owned';
  } else {
    throw new Error('inference session requires either an existing device or a gpu request surface');
  }
  if (deviceOwnership !== 'owned' && deviceOwnership !== 'borrowed') {
    throw new Error('deviceOwnership must be owned or borrowed');
  }
  if (!context.device || typeof context.device !== 'object') throw new Error('device must be an object');
  if (!context.queue || typeof context.queue !== 'object') throw new Error('device queue must be available');
  if (!context.device.lost || typeof context.device.lost.then !== 'function') {
    throw new Error('device.lost promise must be available');
  }
  context.backendIdentity = deepFreeze(clone(context.backendIdentity));

  const admissionCoordinator = input.admissionCoordinator || createWebGpuInferenceCoordinator({
    ...(input.coordinatorOptions || {}),
    now: input.coordinatorOptions?.now || now,
  });
  if (
    typeof admissionCoordinator.requestAdmission !== 'function'
    || typeof admissionCoordinator.snapshot !== 'function'
    || typeof admissionCoordinator.drain !== 'function'
  ) {
    throw new Error('admissionCoordinator must expose requestAdmission, snapshot, and drain');
  }
  const residency = createWebGpuResourceResidency({
    sessionId: input.sessionId,
    now,
  });
  const resourceFactory = createWebGpuResourceFactory({
    sessionId: input.sessionId,
    residency,
    now,
  });
  if (
    typeof residency.acquire !== 'function'
    || typeof residency.snapshot !== 'function'
    || typeof residency.invalidateAll !== 'function'
    || typeof residency.hasActiveLeases !== 'function'
    || typeof residency.routeSnapshot !== 'function'
  ) {
    throw new Error('residency must expose acquire, snapshot, invalidateAll, hasActiveLeases, and routeSnapshot');
  }

  const state = {
    status: 'active',
    deviceLoss: null,
    routes: new Map(),
    registeringRoutes: new Set(),
  };

  function statusError() {
    if (state.status === 'device-lost') {
      return new Error(`WebGPU device lost for session ${input.sessionId}: ${state.deviceLoss?.reason || 'unknown'}`);
    }
    return new Error(`inference session ${input.sessionId} is closed`);
  }

  function assertActive() {
    if (state.status !== 'active') throw statusError();
  }

  function assertAttached(route) {
    if (!route.attached) throw new Error(`route ${route.routeId} is unregistered and detached`);
  }

  function routeSnapshot(route) {
    return {
      schema: WEBGPU_INFERENCE_SESSION_ROUTE_SCHEMA,
      routeId: route.routeId,
      status: route.attached ? 'registered' : 'detached',
      queue: route.queue.snapshot(),
      residency: residency.routeSnapshot(route.routeId),
    };
  }

  function snapshot() {
    return {
      schema: WEBGPU_INFERENCE_SESSION_SCHEMA,
      sessionId: input.sessionId,
      status: state.status,
      deviceOwnership,
      routeRetention: 'uncapped-until-explicit-unregister',
      closeAuthority: 'idle-routes-only-no-active-work-preemption',
      backendIdentity: clone(context.backendIdentity),
      deviceLoss: clone(state.deviceLoss),
      coordinator: admissionCoordinator.snapshot(),
      residency: residency.snapshot(),
      resourceFactory: resourceFactory.snapshot(),
      registeringRouteIds: [...state.registeringRoutes],
      routes: [...state.routes.values()].map(routeSnapshot),
    };
  }

  function recordDeviceLoss(info = {}) {
    if (state.deviceLoss) return state.deviceLoss;
    const reason = isNonEmptyString(info.reason) ? info.reason : 'unknown';
    state.deviceLoss = deepFreeze({
      schema: WEBGPU_INFERENCE_SESSION_DEVICE_LOSS_SCHEMA,
      sessionId: input.sessionId,
      reason,
      message: typeof info.message === 'string' ? info.message : '',
      atMs: now(),
      recoveryAuthority: 'caller-must-create-new-session-and-rebuild-device-resources',
      cancellationAuthority: 'pending-route-jobs-only-no-active-work-preemption',
    });
    if (state.status !== 'closed') state.status = 'device-lost';
    resourceFactory.invalidateAll(`device-lost:${reason}`);
    residency.invalidateAll({ reason: `device-lost:${reason}`, message: state.deviceLoss.message });
    for (const route of state.routes.values()) {
      for (const handle of route.jobHandles.values()) {
        handle.cancel(`device-lost:${reason}`);
      }
    }
    return state.deviceLoss;
  }

  const deviceLost = Promise.resolve(context.device.lost).then(
    info => recordDeviceLoss(info),
    error => recordDeviceLoss({ reason: 'unknown', message: String(error?.message || error) }),
  );

  async function registerRoute(routeInput = {}) {
    assertActive();
    if (!isNonEmptyString(routeInput.routeId)) throw new Error('routeId must be a non-empty string');
    if (state.routes.has(routeInput.routeId) || state.registeringRoutes.has(routeInput.routeId)) {
      throw new Error(`duplicate route ${routeInput.routeId}`);
    }
    const runtimeOptions = routeInput.runtimeOptions || {};
    const queueOptions = routeInput.queueOptions || {};
    if (!isPlainObject(runtimeOptions)) throw new Error('runtimeOptions must be an object');
    if (!isPlainObject(queueOptions)) throw new Error('queueOptions must be an object');
    assertNoReservedOptions(runtimeOptions, RESERVED_RUNTIME_OPTIONS, 'runtimeOptions');
    assertNoReservedOptions(queueOptions, RESERVED_QUEUE_OPTIONS, 'queueOptions');
    state.registeringRoutes.add(routeInput.routeId);
    try {
      const runtime = await createWebGpuInferenceRuntime({
        ...runtimeOptions,
        routeId: routeInput.routeId,
        adapter: context.adapter,
        device: context.device,
        queue: context.queue,
        deviceRequest: context.deviceRequest,
        backendIdentity: context.backendIdentity,
        admissionCoordinator,
      });
      assertActive();
      const queue = runtime.createInferenceQueue(queueOptions);
      const route = {
        routeId: routeInput.routeId,
        runtime,
        queue,
        attached: true,
        jobHandles: new Map(),
        handle: null,
      };
      function acquireResource(resourceInput = {}) {
        assertAttached(route);
        assertActive();
        if (!isPlainObject(resourceInput)) throw new Error('resource input must be an object');
        if (Object.hasOwn(resourceInput, 'routeId')) {
          throw new Error('session route owns routeId; acquireResource cannot override it');
        }
        return residency.acquire({ ...resourceInput, routeId: route.routeId });
      }
      const routeResidency = Object.freeze({
        acquire: acquireResource,
        acquireOrCreate(resourceInput = {}) {
          assertAttached(route);
          assertActive();
          if (!isPlainObject(resourceInput)) throw new Error('resource input must be an object');
          if (Object.hasOwn(resourceInput, 'routeId')) {
            throw new Error('session route owns routeId; acquireOrCreate cannot override it');
          }
          return resourceFactory.acquireOrCreate({ ...resourceInput, routeId: route.routeId });
        },
        snapshot() { return deepFreeze(residency.routeSnapshot(route.routeId)); },
      });
      route.handle = Object.freeze({
        routeId: route.routeId,
        runtime,
        residency: routeResidency,
        acquireResource,
        loadModelResources(modelInput = {}) {
          assertAttached(route);
          assertActive();
          if (!isPlainObject(modelInput)) throw new Error('model resource input must be an object');
          if (Object.hasOwn(modelInput, 'route')) {
            throw new Error('session route owns route; loadModelResources cannot override it');
          }
          return loadWebGpuModelResources({ ...modelInput, route: route.handle });
        },
        enqueue(jobInput = {}) {
          assertAttached(route);
          assertActive();
          const handle = queue.enqueue(jobInput);
          route.jobHandles.set(handle.jobId, handle);
          return handle;
        },
        scheduleSchedulerDecision(decision) {
          assertAttached(route);
          assertActive();
          return queue.scheduleSchedulerDecision(decision);
        },
        drain() {
          assertAttached(route);
          return queue.drain();
        },
        snapshot() {
          return deepFreeze(routeSnapshot(route));
        },
        forgetJob(jobId) {
          assertAttached(route);
          const forgotten = queue.forgetJob(jobId);
          if (forgotten) route.jobHandles.delete(jobId);
          return forgotten;
        },
      });
      state.routes.set(route.routeId, route);
      return route.handle;
    } finally {
      state.registeringRoutes.delete(routeInput.routeId);
    }
  }

  function unregisterRoute(routeId) {
    const route = state.routes.get(routeId);
    if (!route) throw new Error(`unknown route ${routeId || '<missing>'}`);
    const queueSnapshot = route.queue.snapshot();
    if (queueSnapshot.status !== 'idle') {
      throw new Error(`route ${routeId} must drain before unregister; active work is not preempted`);
    }
    if (residency.hasActiveLeases(routeId)) {
      throw new Error(`route ${routeId} must release every resource lease before unregister`);
    }
    if (resourceFactory.hasActiveFlights(routeId)) {
      throw new Error(`route ${routeId} must let every associated resource creation flight settle before unregister`);
    }
    route.attached = false;
    state.routes.delete(routeId);
    return deepFreeze(routeSnapshot(route));
  }

  async function drain() {
    if (state.registeringRoutes.size > 0) {
      throw new Error('route registrations must settle before session drain');
    }
    await Promise.all([
      ...[...state.routes.values()].map(route => route.queue.drain()),
      admissionCoordinator.drain(),
      resourceFactory.drain(),
    ]);
    return deepFreeze(snapshot());
  }

  function close() {
    if (state.status === 'closed') return deepFreeze(snapshot());
    if (state.registeringRoutes.size > 0) {
      throw new Error('route registrations must settle before session close');
    }
    for (const route of state.routes.values()) {
      if (route.queue.snapshot().status !== 'idle') {
        throw new Error('all routes must drain before close; active work is not preempted');
      }
    }
    if (residency.hasActiveLeases()) {
      throw new Error('all routes must release every resource lease before close');
    }
    if (resourceFactory.snapshot().activeFlightCount > 0) {
      throw new Error('all resource creation flights must settle before close');
    }
    state.status = 'closed';
    for (const route of state.routes.values()) route.attached = false;
    residency.invalidateAll({ reason: 'session-closed', disposeManaged: true });
    if (deviceOwnership === 'owned' && typeof context.device.destroy === 'function') {
      context.device.destroy();
    }
    return deepFreeze(snapshot());
  }

  const session = Object.freeze({
    sessionId: input.sessionId,
    adapter: context.adapter,
    device: context.device,
    queue: context.queue,
    backendIdentity: deepFreeze(clone(context.backendIdentity)),
    admissionCoordinator,
    residency,
    resourceFactory,
    deviceLost,
    registerRoute,
    unregisterRoute,
    drain,
    close,
    snapshot() { return deepFreeze(snapshot()); },
  });

  await Promise.resolve();
  return session;
}
