import { validateWebGpuBackendIdentity } from './gpu-environment.js';
import {
  assertAuthoritativeRouteReceipt,
  validateRouteReceipt,
} from './route-receipt.js';
import {
  validateWebGpuRouteBackpressureProfile,
  validateWebGpuRouteSchedulerProfile,
} from './scheduler-backpressure.js';

export const WEBGPU_ROUTE_DEFINITION_SCHEMA = 'kaminos.webgpu-route-definition.v0';
export const WEBGPU_ROUTE_REQUEST_SCHEMA = 'kaminos.webgpu-route-request.v0';
export const WEBGPU_ROUTE_RESULT_SCHEMA = 'kaminos.webgpu-route-result.v0';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepEqual(a, b) {
  return stableJson(a) === stableJson(b);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(errors, value, path) {
  if (!isNonEmptyString(value)) errors.push(`${path} must be a non-empty string`);
}

function roleName(entry) {
  return typeof entry === 'string' ? entry : entry?.role;
}

function normalizeRoles(entries = [], { defaultRequired = true } = {}) {
  if (!Array.isArray(entries)) return [];

  return entries.map(entry => {
    if (typeof entry === 'string') {
      return {
        role: entry,
        required: defaultRequired,
        artifactRequired: true,
        hashRequired: true,
      };
    }

    return {
      role: entry.role,
      required: entry.required !== false,
      artifactRequired: entry.artifactRequired !== false,
      hashRequired: entry.hashRequired !== false,
      shape: Array.isArray(entry.shape) ? [...entry.shape] : undefined,
    };
  });
}

function roleSet(roles) {
  return new Set(roles.map(role => role.role));
}

function artifactArray(roles, artifacts = {}, { includeOptional = true, requireKnown = true } = {}) {
  const byRole = Array.isArray(artifacts)
    ? Object.fromEntries(artifacts.map(artifact => [artifact?.role, artifact]))
    : artifacts;
  const knownRoles = roleSet(roles);
  const out = [];

  for (const role of roles) {
    const artifact = byRole?.[role.role];
    if (!artifact) {
      if (role.required || !includeOptional) {
        out.push({ role: role.role });
      }
      continue;
    }

    out.push({
      role: role.role,
      artifactId: artifact.artifactId,
      sha256: artifact.sha256,
      shape: Array.isArray(artifact.shape) ? [...artifact.shape] : undefined,
      status: artifact.status,
    });
  }

  if (requireKnown && byRole && typeof byRole === 'object') {
    for (const key of Object.keys(byRole)) {
      if (!knownRoles.has(key)) {
        out.push({ role: key, unknownRole: true, ...clone(byRole[key]) });
      }
    }
  }

  return out;
}

function requiredRoleNames(roles) {
  return roles.filter(role => role.required !== false).map(role => role.role);
}

function optionalRoleNames(roles) {
  return roles.filter(role => role.required === false).map(role => role.role);
}

function routeTimingStageNames(timings = {}) {
  const names = new Set();
  const addStageName = stage => {
    if (isNonEmptyString(stage)) names.add(stage);
    if (isNonEmptyString(stage?.name)) names.add(stage.name);
  };

  if (Array.isArray(timings.stages)) {
    timings.stages.forEach(addStageName);
  }

  const profile = timings.profile;
  if (profile && typeof profile === 'object') {
    if (Array.isArray(profile.stageNames)) {
      profile.stageNames.forEach(addStageName);
    }
    if (Array.isArray(profile.stages)) {
      profile.stages.forEach(addStageName);
    }
  }

  return names;
}

function validateRouteTiming(errors, receipt, route) {
  const timings = receipt?.timings;
  if (!timings || !route) return;

  if (isNonEmptyString(route.timingSource) && timings.source !== route.timingSource) {
    errors.push(`receipt.timings.source must be ${route.timingSource}`);
  }

  const requiredStages = Array.isArray(route.requiredStages) ? route.requiredStages : [];
  if (requiredStages.length === 0) return;

  const stageNames = routeTimingStageNames(timings);
  for (const stageName of requiredStages) {
    if (!stageNames.has(stageName)) {
      errors.push(`receipt.timings missing required stage ${stageName}`);
    }
  }
}

function validateArtifacts(errors, artifacts, roles, path, { requireHash }) {
  const knownRoles = roleSet(roles);
  const artifactsByRole = new Map();

  if (!Array.isArray(artifacts)) {
    errors.push(`${path} must be an array`);
    return;
  }

  artifacts.forEach((artifact, index) => {
    const artifactPath = `${path}[${index}]`;
    requireString(errors, artifact?.role, `${artifactPath}.role`);
    if (isNonEmptyString(artifact?.role)) {
      if (artifactsByRole.has(artifact.role)) errors.push(`${artifactPath}.role duplicates ${artifact.role}`);
      artifactsByRole.set(artifact.role, artifact);
      if (!knownRoles.has(artifact.role)) errors.push(`${artifactPath}.role is not defined by route`);
    }
    if (artifact?.unknownRole) errors.push(`${artifactPath}.role is not defined by route`);
    requireString(errors, artifact?.artifactId, `${artifactPath}.artifactId`);
    if (requireHash) requireString(errors, artifact?.sha256, `${artifactPath}.sha256`);
    if (artifact?.shape != null && (!Array.isArray(artifact.shape) || !artifact.shape.every(Number.isInteger))) {
      errors.push(`${artifactPath}.shape must be an integer array when present`);
    }
  });

  for (const role of roles) {
    if (role.required !== false && !artifactsByRole.has(role.role)) {
      errors.push(`${path} missing required role ${role.role}`);
    }
  }
}

export function defineWebGpuRoute(input) {
  if (!input || typeof input !== 'object') throw new Error('route input must be an object');

  const inputRoles = normalizeRoles(input.inputs || input.inputRoles, { defaultRequired: true });
  const outputRoles = normalizeRoles(input.outputs || input.outputRoles, { defaultRequired: true });

  return {
    schema: WEBGPU_ROUTE_DEFINITION_SCHEMA,
    routeId: input.routeId,
    backendKind: input.backendKind || 'webgpu-local',
    model: clone(input.model),
    kernel: clone(input.kernel),
    inputRoles,
    outputRoles,
    requiredInputRoles: requiredRoleNames(inputRoles),
    requiredOutputRoles: requiredRoleNames(outputRoles),
    optionalOutputRoles: optionalRoleNames(outputRoles),
    requiredFeatures: Array.isArray(input.requiredFeatures) ? [...input.requiredFeatures].map(String).sort() : [],
    requiredStages: Array.isArray(input.requiredStages) ? [...input.requiredStages] : [],
    timingSource: input.timingSource || 'queue-submit-wait',
    scheduler: clone(input.scheduler || null),
    backpressure: clone(input.backpressure || null),
    worker: clone(input.worker || null),
  };
}

export function validateRouteDefinition(route) {
  const errors = [];

  if (!route || typeof route !== 'object') {
    return { ok: false, errors: ['route must be an object'] };
  }

  if (route.schema !== WEBGPU_ROUTE_DEFINITION_SCHEMA) errors.push(`schema must be ${WEBGPU_ROUTE_DEFINITION_SCHEMA}`);
  requireString(errors, route.routeId, 'routeId');
  if (route.backendKind !== 'webgpu-local') errors.push('backendKind must be webgpu-local');

  if (!route.model || typeof route.model !== 'object') {
    errors.push('model must be an object');
  } else {
    requireString(errors, route.model.id, 'model.id');
  }

  if (!route.kernel || typeof route.kernel !== 'object') {
    errors.push('kernel must be an object');
  } else {
    requireString(errors, route.kernel.profile, 'kernel.profile');
  }

  if (!Array.isArray(route.inputRoles) || route.inputRoles.length === 0) {
    errors.push('inputRoles must be a non-empty array');
  } else {
    route.inputRoles.forEach((role, index) => requireString(errors, role?.role, `inputRoles[${index}].role`));
  }

  if (!Array.isArray(route.outputRoles) || route.outputRoles.length === 0) {
    errors.push('outputRoles must be a non-empty array');
  } else {
    route.outputRoles.forEach((role, index) => requireString(errors, role?.role, `outputRoles[${index}].role`));
  }

  if (!Array.isArray(route.requiredInputRoles) || route.requiredInputRoles.length === 0) {
    errors.push('requiredInputRoles must be a non-empty array');
  }
  if (!Array.isArray(route.requiredOutputRoles) || route.requiredOutputRoles.length === 0) {
    errors.push('requiredOutputRoles must be a non-empty array');
  }
  if (!isNonEmptyString(route.timingSource)) errors.push('timingSource must be a non-empty string');

  if (route.scheduler != null) {
    const schedulerResult = validateWebGpuRouteSchedulerProfile(route.scheduler);
    if (!schedulerResult.ok) errors.push(...schedulerResult.errors.map(error => `scheduler.${error}`));
  }

  if (route.backpressure != null) {
    const backpressureResult = validateWebGpuRouteBackpressureProfile(route.backpressure);
    if (!backpressureResult.ok) errors.push(...backpressureResult.errors.map(error => `backpressure.${error}`));
  }

  return { ok: errors.length === 0, errors };
}

export function createWebGpuRouteRegistry(initialRoutes = []) {
  const routes = new Map();

  function register(route) {
    const result = validateRouteDefinition(route);
    if (!result.ok) throw new Error(`invalid route definition: ${result.errors.join('; ')}`);
    if (routes.has(route.routeId)) throw new Error(`duplicate route: ${route.routeId}`);
    routes.set(route.routeId, route);
    return route;
  }

  for (const route of initialRoutes) register(route);

  return {
    register,
    has(routeId) {
      return routes.has(routeId);
    },
    get(routeId) {
      const route = routes.get(routeId);
      if (!route) throw new Error(`unknown route: ${routeId}`);
      return route;
    },
    list() {
      return Array.from(routes.values());
    },
    createRequest(routeId, input) {
      return createRouteInvocationRequest(this.get(routeId), input);
    },
  };
}

export function createRouteInvocationRequest(route, input) {
  const result = validateRouteDefinition(route);
  if (!result.ok) throw new Error(`invalid route definition: ${result.errors.join('; ')}`);
  if (!input || typeof input !== 'object') throw new Error('route request input must be an object');
  if (!isNonEmptyString(input.requestId)) throw new Error('requestId must be a non-empty string');

  return {
    schema: WEBGPU_ROUTE_REQUEST_SCHEMA,
    requestId: input.requestId,
    routeId: route.routeId,
    backendKind: route.backendKind,
    inputs: artifactArray(route.inputRoles, input.inputs, { includeOptional: false }),
    outputs: artifactArray(route.outputRoles, input.outputs, { includeOptional: true }).map(output => ({
      role: output.role,
      artifactId: output.artifactId,
      shape: output.shape,
      unknownRole: output.unknownRole,
    })),
    routeConfig: clone(input.routeConfig || {}),
    model: clone(route.model),
    kernel: clone(route.kernel),
    scheduler: clone(route.scheduler || null),
    backpressure: clone(route.backpressure || null),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function validateRouteInvocationRequest(request, route) {
  const errors = [];
  const routeResult = validateRouteDefinition(route);
  if (!routeResult.ok) errors.push(...routeResult.errors.map(error => `route.${error}`));

  if (!request || typeof request !== 'object') {
    return { ok: false, errors: ['request must be an object'] };
  }
  if (request.schema !== WEBGPU_ROUTE_REQUEST_SCHEMA) errors.push(`schema must be ${WEBGPU_ROUTE_REQUEST_SCHEMA}`);
  requireString(errors, request.requestId, 'requestId');
  if (request.routeId !== route?.routeId) errors.push('routeId must match route definition');
  if (request.backendKind !== 'webgpu-local') errors.push('backendKind must be webgpu-local');

  if (routeResult.ok) {
    validateArtifacts(errors, request.inputs, route.inputRoles, 'inputs', { requireHash: true });
    validateArtifacts(errors, request.outputs, route.outputRoles, 'outputs', { requireHash: false });
  }

  if (request.scheduler != null) {
    const schedulerResult = validateWebGpuRouteSchedulerProfile(request.scheduler);
    if (!schedulerResult.ok) errors.push(...schedulerResult.errors.map(error => `scheduler.${error}`));
  }
  if (route?.scheduler != null) {
    if (request.scheduler == null) {
      errors.push('scheduler must match route definition');
    } else if (!deepEqual(request.scheduler, route.scheduler)) {
      errors.push('scheduler must match route definition');
    }
  }

  if (request.backpressure != null) {
    const backpressureResult = validateWebGpuRouteBackpressureProfile(request.backpressure);
    if (!backpressureResult.ok) errors.push(...backpressureResult.errors.map(error => `backpressure.${error}`));
  }
  if (route?.backpressure != null) {
    if (request.backpressure == null) {
      errors.push('backpressure must match route definition');
    } else if (!deepEqual(request.backpressure, route.backpressure)) {
      errors.push('backpressure must match route definition');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function createRouteWorkerResult(route, input) {
  if (!input || typeof input !== 'object') throw new Error('worker result input must be an object');
  const request = input.request || {};
  const receipt = input.receipt;

  return {
    schema: WEBGPU_ROUTE_RESULT_SCHEMA,
    requestId: request.requestId,
    routeId: route.routeId,
    status: receipt?.status || 'unknown',
    request: clone(request),
    receipt: clone(receipt),
    backend: clone(receipt?.backend),
    outputs: clone(receipt?.outputs || []),
    timings: clone(receipt?.timings),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function validateRouteWorkerResult(result, route) {
  const errors = [];
  const routeResult = validateRouteDefinition(route);
  if (!routeResult.ok) errors.push(...routeResult.errors.map(error => `route.${error}`));

  if (!result || typeof result !== 'object') {
    return { ok: false, errors: ['result must be an object'] };
  }

  if (result.schema !== WEBGPU_ROUTE_RESULT_SCHEMA) errors.push(`schema must be ${WEBGPU_ROUTE_RESULT_SCHEMA}`);
  requireString(errors, result.requestId, 'requestId');
  if (result.routeId !== route?.routeId) errors.push('routeId must match route definition');

  if (result.request != null) {
    const requestResult = validateRouteInvocationRequest(result.request, route);
    if (!requestResult.ok) errors.push(...requestResult.errors.map(error => `request.${error}`));
  }

  const receiptResult = validateRouteReceipt(result.receipt);
  if (!receiptResult.ok) {
    errors.push(...receiptResult.errors.map(error => `receipt.${error}`));
  } else {
    if (result.receipt.requestedRouteId !== route.routeId) {
      errors.push('receipt.requestedRouteId must match route definition');
    }
    if (result.receipt.effectiveRouteId !== route.routeId) {
      errors.push('receipt.effectiveRouteId must match route definition');
    }
    if (routeResult.ok) validateRouteTiming(errors, result.receipt, route);
  }

  const backendResult = validateWebGpuBackendIdentity(result.backend);
  if (!backendResult.ok) errors.push(...backendResult.errors.map(error => `backend.${error}`));

  if (routeResult.ok && Array.isArray(result.outputs)) {
    validateArtifacts(errors, result.outputs, route.outputRoles, 'outputs', { requireHash: true });
  } else if (!Array.isArray(result.outputs)) {
    errors.push('outputs must be an array');
  }

  return { ok: errors.length === 0, errors };
}

export function assertAuthoritativeRouteWorkerResult(result, route) {
  const validation = validateRouteWorkerResult(result, route);
  if (!validation.ok) {
    throw new Error(`invalid route worker result: ${validation.errors.join('; ')}`);
  }

  assertAuthoritativeRouteReceipt(result.receipt);
  return result;
}
