import {
  validateWebGpuModelResourceManifest,
} from './model-resource-manifest.js';

export const WEBGPU_MODEL_RESOURCE_PACKAGE_SCHEMA = 'kaminos.webgpu-model-resource-package.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_LEASE_SCHEMA = 'kaminos.webgpu-model-resource-package-lease.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_REPORT_SCHEMA = 'kaminos.webgpu-model-resource-package-report.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_PROGRESS_SCHEMA = 'kaminos.webgpu-model-resource-package-progress.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function abortError(signal) {
  const error = new Error(String(signal?.reason || 'model resource package load aborted'));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function packageIdentity(input) {
  const resources = input.resources
    .map(resource => `${encodeURIComponent(resource.resourceId)}=${encodeURIComponent(resource.manifest.identity)}`)
    .join('&');
  return `${encodeURIComponent(input.packageId)}:${encodeURIComponent(input.modelId)}@${encodeURIComponent(input.revision)}#resources:${resources}`;
}

function sourceMemoryBound(modelPackage) {
  return deepFreeze({
    authority: 'sequential-resource-acquisition-declared-byte-length',
    largestResourceByteLength: modelPackage.largestResourceByteLength,
    totalPackageByteLength: modelPackage.totalByteLength,
    residual: 'one-resource-source-acquisition-may-retain-multiple-host-representations',
  });
}

function releaseChildLeases(childLeases) {
  const releases = [];
  for (const child of childLeases) {
    try {
      releases.push(deepFreeze({ resourceId: child.resourceId, release: child.lease.release() }));
    } catch (error) {
      releases.push(deepFreeze({
        resourceId: child.resourceId,
        release: { status: 'release-failed', message: String(error?.message || error) },
      }));
    }
  }
  const failedResourceIds = releases
    .filter(item => item.release.status === 'release-failed')
    .map(item => item.resourceId);
  return deepFreeze({
    status: failedResourceIds.length === 0 ? 'released' : 'release-failed',
    releasedResourceCount: releases.length - failedResourceIds.length,
    failedResourceIds,
    releases,
  });
}

function errorWithPackageReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  try {
    error.packageReport = report;
    if (error.packageReport === report) return error;
  } catch {}
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.packageReport = report;
  return wrapped;
}

export function validateWebGpuModelResourcePackage(modelPackage) {
  const errors = [];
  if (!modelPackage || typeof modelPackage !== 'object' || Array.isArray(modelPackage)) {
    return { ok: false, errors: ['model resource package must be an object'] };
  }
  if (modelPackage.schema !== WEBGPU_MODEL_RESOURCE_PACKAGE_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_MODEL_RESOURCE_PACKAGE_SCHEMA}`);
  }
  if (!isNonEmptyString(modelPackage.packageId)) errors.push('packageId must be a non-empty string');
  if (!isNonEmptyString(modelPackage.modelId)) errors.push('modelId must be a non-empty string');
  if (!isNonEmptyString(modelPackage.revision)) errors.push('revision must be a non-empty string');
  if (modelPackage.maxResources != null || modelPackage.maxBytes != null || modelPackage.retentionLimit != null) {
    errors.push('model resource packages are uncapped; maxResources, maxBytes, and retentionLimit are not supported');
  }
  if (!Array.isArray(modelPackage.resources) || modelPackage.resources.length === 0) {
    errors.push('resources must be a non-empty array');
    return { ok: false, errors };
  }

  const resourceIds = new Set();
  const tensorNames = new Set();
  let totalByteLength = 0;
  let largestResourceByteLength = 0;
  modelPackage.resources.forEach((resource, index) => {
    const prefix = `resources[${index}]`;
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (!isNonEmptyString(resource.resourceId)) {
      errors.push(`${prefix}.resourceId must be a non-empty string`);
    } else if (resourceIds.has(resource.resourceId)) {
      errors.push(`duplicate package resourceId ${resource.resourceId}`);
    } else {
      resourceIds.add(resource.resourceId);
    }
    const validation = validateWebGpuModelResourceManifest(resource.manifest);
    if (!validation.ok) {
      errors.push(...validation.errors.map(error => `${prefix}.manifest: ${error}`));
      return;
    }
    if (resource.manifest.modelId !== modelPackage.modelId) {
      errors.push(`${prefix}.manifest.modelId must match package modelId`);
    }
    if (resource.manifest.revision !== modelPackage.revision) {
      errors.push(`${prefix}.manifest.revision must match package revision`);
    }
    totalByteLength += resource.manifest.bundle.byteLength;
    if (!Number.isSafeInteger(totalByteLength)) errors.push('total package byte length exceeds safe integer range');
    largestResourceByteLength = Math.max(largestResourceByteLength, resource.manifest.bundle.byteLength);
    for (const allocation of resource.manifest.allocations) {
      for (const tensor of allocation.tensors) {
        if (tensorNames.has(tensor.name)) errors.push(`duplicate package tensor name ${tensor.name}; tensor names must be unique`);
        tensorNames.add(tensor.name);
      }
    }
  });

  if (!Array.isArray(modelPackage.resourceIds)) {
    errors.push('resourceIds must be an array matching resources in declaration order');
  } else if (
    modelPackage.resourceIds.length !== resourceIds.size
    || modelPackage.resourceIds.some((resourceId, index) => resourceId !== [...resourceIds][index])
  ) {
    errors.push('resourceIds must match resources in declaration order');
  }
  if (!Number.isSafeInteger(modelPackage.totalByteLength) || modelPackage.totalByteLength <= 0) {
    errors.push('totalByteLength must be a positive safe integer');
  } else if (modelPackage.totalByteLength !== totalByteLength) {
    errors.push('totalByteLength must equal the sum of resource bundle byte lengths');
  }
  if (!Number.isSafeInteger(modelPackage.largestResourceByteLength) || modelPackage.largestResourceByteLength <= 0) {
    errors.push('largestResourceByteLength must be a positive safe integer');
  } else if (modelPackage.largestResourceByteLength !== largestResourceByteLength) {
    errors.push('largestResourceByteLength must equal the largest resource bundle byte length');
  }
  if (
    errors.length === 0
    && modelPackage.identity !== packageIdentity(modelPackage)
  ) {
    errors.push('identity must match packageId, modelId, revision, and ordered resource manifests');
  }
  return { ok: errors.length === 0, errors };
}

export function defineWebGpuModelResourcePackage(input = {}) {
  if (input.maxResources != null || input.maxBytes != null || input.retentionLimit != null) {
    throw new Error('model resource packages are uncapped; maxResources, maxBytes, and retentionLimit are not supported');
  }
  const resources = (input.resources || []).map(resource => ({
    resourceId: resource?.resourceId,
    manifest: resource?.manifest,
  }));
  const totalByteLength = resources.reduce(
    (total, resource) => total + (resource.manifest?.bundle?.byteLength || 0),
    0,
  );
  const largestResourceByteLength = resources.reduce(
    (largest, resource) => Math.max(largest, resource.manifest?.bundle?.byteLength || 0),
    0,
  );
  const modelPackage = {
    schema: WEBGPU_MODEL_RESOURCE_PACKAGE_SCHEMA,
    packageId: input.packageId,
    modelId: input.modelId,
    revision: input.revision,
    resources,
    resourceIds: resources.map(resource => resource.resourceId),
    totalByteLength,
    largestResourceByteLength,
  };
  modelPackage.identity = packageIdentity(modelPackage);
  const validation = validateWebGpuModelResourcePackage(modelPackage);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource package:\n${validation.errors.join('\n')}`);
  return deepFreeze(modelPackage);
}

function validateSources(modelPackage, sources) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    throw new Error('model resource package sources must be an object keyed by resourceId');
  }
  const expected = new Set(modelPackage.resourceIds);
  for (const resourceId of expected) {
    if (!Object.hasOwn(sources, resourceId) || sources[resourceId] == null) {
      throw new Error(`missing source for model package resource ${resourceId}`);
    }
  }
  for (const resourceId of Object.keys(sources)) {
    if (!expected.has(resourceId)) throw new Error(`unknown model package source ${resourceId}`);
  }
}

export async function loadWebGpuModelResourcePackageFromSources(input = {}) {
  const validation = validateWebGpuModelResourcePackage(input.package);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource package:\n${validation.errors.join('\n')}`);
  const modelPackage = defineWebGpuModelResourcePackage(input.package);
  if (!input.route || typeof input.route.loadModelResourcesFromSource !== 'function') {
    throw new Error('model resource package loading requires a registered session route');
  }
  if (input.maxResources != null || input.maxBytes != null || input.maxProgressEvents != null) {
    throw new Error('model resource package loading is uncapped; maxResources, maxBytes, and maxProgressEvents are not supported');
  }
  validateSources(modelPackage, input.sources);
  const sources = Object.create(null);
  for (const resourceId of modelPackage.resourceIds) sources[resourceId] = input.sources[resourceId];
  Object.freeze(sources);
  throwIfAborted(input.signal);

  const now = typeof input.now === 'function'
    ? input.now
    : (() => globalThis.performance?.now?.() ?? Date.now());
  const startedAtMs = now();
  const progress = [];
  const childLeases = [];
  const resources = [];

  function recordProgress(resource, resourceIndex, event) {
    const packageEvent = deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_PACKAGE_PROGRESS_SCHEMA,
      sequence: progress.length + 1,
      packageIdentity: modelPackage.identity,
      resourceId: resource.resourceId,
      resourceIndex,
      resourceCount: modelPackage.resources.length,
      resourceEvent: event,
    });
    progress.push(packageEvent);
    if (typeof input.onProgress === 'function') input.onProgress(packageEvent);
  }

  try {
    for (let index = 0; index < modelPackage.resources.length; index += 1) {
      throwIfAborted(input.signal);
      const resource = modelPackage.resources[index];
      let lease;
      try {
        lease = await input.route.loadModelResourcesFromSource({
          manifest: resource.manifest,
          source: sources[resource.resourceId],
          cache: input.cache,
          fetch: input.fetch,
          fetchOptions: input.fetchOptions,
          ownership: input.ownership,
          signal: input.signal,
          subtle: input.subtle,
          now: input.now,
          onProgress: event => recordProgress(resource, index, event),
        });
      } catch (error) {
        const cleanup = releaseChildLeases(childLeases);
        const report = deepFreeze({
          schema: WEBGPU_MODEL_RESOURCE_PACKAGE_REPORT_SCHEMA,
          status: error?.name === 'AbortError' ? 'canceled' : 'failed',
          packageIdentity: modelPackage.identity,
          routeId: input.route.routeId,
          startedAtMs,
          settledAtMs: now(),
          failedResourceId: resource.resourceId,
          failure: {
            name: error?.name || 'Error',
            message: String(error?.message || error),
            acquisitionReport: error?.acquisitionReport || null,
          },
          resources: resources.map(item => ({
            resourceId: item.resourceId,
            acquisitionReport: item.acquisitionReport,
          })),
          progress,
          sourceMemoryBound: sourceMemoryBound(modelPackage),
          cleanup,
        });
        throw errorWithPackageReport(error, report);
      }
      childLeases.push({ resourceId: resource.resourceId, lease });
      resources.push(deepFreeze({
        resourceId: resource.resourceId,
        manifest: resource.manifest,
        acquisitionReport: lease.acquisitionReport,
        allocations: lease.allocations,
        tensors: lease.tensors,
      }));
    }
  } catch (error) {
    if (error?.packageReport) throw error;
    const cleanup = releaseChildLeases(childLeases);
    const report = deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_PACKAGE_REPORT_SCHEMA,
      status: error?.name === 'AbortError' ? 'canceled' : 'failed',
      packageIdentity: modelPackage.identity,
      routeId: input.route.routeId,
      startedAtMs,
      settledAtMs: now(),
      failedResourceId: null,
      failure: { name: error?.name || 'Error', message: String(error?.message || error) },
      resources: resources.map(item => ({
        resourceId: item.resourceId,
        acquisitionReport: item.acquisitionReport,
      })),
      progress,
      sourceMemoryBound: sourceMemoryBound(modelPackage),
      cleanup,
    });
    throw errorWithPackageReport(error, report);
  }

  const allocations = [];
  const tensors = Object.create(null);
  for (const resource of resources) {
    for (const allocation of resource.allocations) {
      allocations.push(Object.freeze({ packageResourceId: resource.resourceId, ...allocation }));
    }
    for (const [name, tensor] of Object.entries(resource.tensors)) {
      tensors[name] = Object.freeze({ packageResourceId: resource.resourceId, ...tensor });
    }
  }
  const report = deepFreeze({
    schema: WEBGPU_MODEL_RESOURCE_PACKAGE_REPORT_SCHEMA,
    status: 'loaded',
    packageIdentity: modelPackage.identity,
    routeId: input.route.routeId,
    startedAtMs,
    settledAtMs: now(),
    failedResourceId: null,
    failure: null,
    resources: resources.map(resource => ({
      resourceId: resource.resourceId,
      acquisitionReport: resource.acquisitionReport,
    })),
    progress,
    sourceMemoryBound: sourceMemoryBound(modelPackage),
    cleanup: null,
  });

  let released = false;
  return Object.freeze({
    schema: WEBGPU_MODEL_RESOURCE_PACKAGE_LEASE_SCHEMA,
    identity: modelPackage.identity,
    packageId: modelPackage.packageId,
    modelId: modelPackage.modelId,
    revision: modelPackage.revision,
    routeId: input.route.routeId,
    package: modelPackage,
    resources: Object.freeze(resources),
    allocations: Object.freeze(allocations),
    tensors: Object.freeze(tensors),
    report,
    release() {
      if (released) {
        return deepFreeze({
          schema: WEBGPU_MODEL_RESOURCE_PACKAGE_LEASE_SCHEMA,
          identity: modelPackage.identity,
          routeId: input.route.routeId,
          status: 'already-released',
          releasedResourceCount: 0,
        });
      }
      released = true;
      const cleanup = releaseChildLeases(childLeases);
      return deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_PACKAGE_LEASE_SCHEMA,
        identity: modelPackage.identity,
        routeId: input.route.routeId,
        ...cleanup,
      });
    },
  });
}
