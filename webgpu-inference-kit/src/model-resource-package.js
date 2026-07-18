import {
  defineWebGpuModelResourceManifest,
  validateWebGpuModelResourceManifest,
} from './model-resource-manifest.js';
import {
  describeWebGpuModelResourceSource,
} from './model-resource-source.js';
import {
  materializeWebGpuModelFetchOptions,
  snapshotWebGpuModelFetchOptions,
} from './model-resource-fetch-options.js';
import {
  defineWebGpuModelResourceChunkPlan,
  preflightWebGpuModelResourceChunkSources,
  snapshotWebGpuModelResourceChunkSources,
  validateWebGpuModelResourceChunkPlan,
} from './model-resource-chunk-plan.js';

export const WEBGPU_MODEL_RESOURCE_PACKAGE_SCHEMA = 'kaminos.webgpu-model-resource-package.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_LEASE_SCHEMA = 'kaminos.webgpu-model-resource-package-lease.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_REPORT_SCHEMA = 'kaminos.webgpu-model-resource-package-report.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_PROGRESS_SCHEMA = 'kaminos.webgpu-model-resource-package-progress.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_LOADER_SCHEMA = 'kaminos.webgpu-model-resource-package-loader.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_CHILD_LEASE_SCHEMA = 'kaminos.webgpu-model-resource-package-child-lease.v0';
export const WEBGPU_MODEL_RESOURCE_PACKAGE_CHILD_REPORT_SCHEMA = 'kaminos.webgpu-model-resource-package-child-report.v0';

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

function manifestSemanticIdentity(manifest) {
  const allocations = manifest.allocations
    .map(allocation => encodeURIComponent(allocation.semanticResourceId))
    .join(',');
  return `${encodeURIComponent(manifest.identity)}#allocations:${allocations}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value != null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedManifestFingerprint(manifest) {
  return canonicalJson(defineWebGpuModelResourceManifest(manifest));
}

function packageIdentity(input) {
  const resources = input.resources
    .map(resource => {
      const loaderIdentity = resource.chunkPlan
        ? `:chunks:${encodeURIComponent(resource.chunkPlan.identity)}`
        : '';
      return `${encodeURIComponent(resource.resourceId)}=${manifestSemanticIdentity(resource.manifest)}${loaderIdentity}`;
    })
    .join('&');
  return `${encodeURIComponent(input.packageId)}:${encodeURIComponent(input.modelId)}@${encodeURIComponent(input.revision)}#resources:${resources}`;
}

function sourceMemoryBound(modelPackage) {
  const hasChunkResource = modelPackage.resources.some(resource => resource.chunkPlan);
  return deepFreeze({
    authority: hasChunkResource
      ? 'sequential-package-child-acquisition-declared-source-unit'
      : 'sequential-resource-acquisition-declared-byte-length',
    largestResourceByteLength: modelPackage.largestResourceByteLength,
    largestSourceByteLength: modelPackage.largestSourceByteLength ?? modelPackage.largestResourceByteLength,
    totalPackageByteLength: modelPackage.totalByteLength,
    residual: hasChunkResource
      ? 'one-ordinary-resource-or-chunk-source-acquisition-may-retain-multiple-host-representations'
      : 'one-resource-source-acquisition-may-retain-multiple-host-representations',
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
  const invalidatedResourceIds = releases
    .filter(item => item.release.status === 'invalidated')
    .map(item => item.resourceId);
  const releasedResourceCount = releases.filter(item => (
    item.release.status == null
    || item.release.status === 'released'
    || item.release.status === 'already-released'
  )).length;
  return deepFreeze({
    status: failedResourceIds.length > 0
      ? 'release-failed'
      : (invalidatedResourceIds.length > 0 ? 'invalidated' : 'released'),
    releasedResourceCount,
    invalidatedResourceCount: invalidatedResourceIds.length,
    failedResourceIds,
    invalidatedResourceIds,
    releases,
  });
}

function errorWithPackageReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!Object.hasOwn(error, 'packageReport')) {
    try {
      error.packageReport = report;
      if (error.packageReport === report) return error;
    } catch {}
  }
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.packageReport = report;
  return wrapped;
}

function errorWithPackageChildReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!Object.hasOwn(error, 'packageChildReport')) {
    try {
      error.packageChildReport = report;
      if (error.packageChildReport === report) return error;
    } catch {}
  }
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.packageChildReport = report;
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
  let largestSourceByteLength = 0;
  let hasChunkResource = false;
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
    const expectedLoadKind = resource.chunkPlan ? 'chunks' : 'source';
    if (resource.loadKind != null && resource.loadKind !== expectedLoadKind) {
      errors.push(`${prefix}.loadKind must match the declared child loader`);
    }
    if (resource.chunkPlan) {
      hasChunkResource = true;
      const chunkValidation = validateWebGpuModelResourceChunkPlan(resource.chunkPlan);
      if (!chunkValidation.ok) {
        errors.push(...chunkValidation.errors.map(error => `${prefix}.chunkPlan: ${error}`));
      } else if (
        normalizedManifestFingerprint(resource.chunkPlan.manifest)
        !== normalizedManifestFingerprint(resource.manifest)
      ) {
        errors.push(`${prefix}.manifest must match the exact normalized chunkPlan.manifest`);
      }
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
    largestSourceByteLength = Math.max(
      largestSourceByteLength,
      resource.chunkPlan?.largestChunkByteLength ?? resource.manifest.bundle.byteLength,
    );
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
  if (modelPackage.largestSourceByteLength == null && !hasChunkResource) {
    // Source-only v0 package objects remain valid across the additive chunk extension.
  } else if (!Number.isSafeInteger(modelPackage.largestSourceByteLength) || modelPackage.largestSourceByteLength <= 0) {
    errors.push('largestSourceByteLength must be a positive safe integer');
  } else if (modelPackage.largestSourceByteLength !== largestSourceByteLength) {
    errors.push('largestSourceByteLength must equal the largest ordinary resource or declared chunk');
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
  const resources = (input.resources || []).map(resource => {
    const chunkPlan = resource?.chunkPlan
      ? defineWebGpuModelResourceChunkPlan(resource.chunkPlan)
      : null;
    if (
      chunkPlan
      && resource?.manifest != null
      && normalizedManifestFingerprint(resource.manifest)
        !== normalizedManifestFingerprint(chunkPlan.manifest)
    ) {
      throw new Error(`package resource ${resource?.resourceId || '<missing>'} manifest must match the exact normalized chunkPlan.manifest`);
    }
    return {
      resourceId: resource?.resourceId,
      loadKind: chunkPlan ? 'chunks' : 'source',
      manifest: chunkPlan?.manifest ?? resource?.manifest,
      ...(chunkPlan ? { chunkPlan } : {}),
    };
  });
  const totalByteLength = resources.reduce(
    (total, resource) => total + (resource.manifest?.bundle?.byteLength || 0),
    0,
  );
  const largestResourceByteLength = resources.reduce(
    (largest, resource) => Math.max(largest, resource.manifest?.bundle?.byteLength || 0),
    0,
  );
  const largestSourceByteLength = resources.reduce(
    (largest, resource) => Math.max(
      largest,
      resource.chunkPlan?.largestChunkByteLength ?? resource.manifest?.bundle?.byteLength ?? 0,
    ),
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
    largestSourceByteLength,
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
  const descriptions = new Map();
  for (const resourceId of expected) {
    if (!Object.hasOwn(sources, resourceId) || sources[resourceId] == null) {
      throw new Error(`missing source for model package resource ${resourceId}`);
    }
    const resource = modelPackage.resources.find(candidate => candidate.resourceId === resourceId);
    descriptions.set(resourceId, resource.chunkPlan
      ? preflightWebGpuModelResourceChunkSources(resource.chunkPlan, sources[resourceId])
      : describeWebGpuModelResourceSource(sources[resourceId]));
  }
  for (const resourceId of Object.keys(sources)) {
    if (!expected.has(resourceId)) throw new Error(`unknown model package source ${resourceId}`);
  }
  if (modelPackage.resources.length > 1) {
    for (const [resourceId, description] of descriptions) {
      if (description instanceof Map) continue;
      if (description.kind === 'array-buffer' || description.kind === 'typed-array') {
        throw new Error(
          `multi-resource model package source ${resourceId} uses mutable bytes; wrap direct bytes in an immutable Blob or use a URL, Request, or Response source`,
        );
      }
    }
  }
  return descriptions;
}

function snapshotOrdinarySource(source, description) {
  if (description.kind === 'array-buffer') {
    const bytes = source.slice(0);
    return typeof globalThis.Blob === 'function'
      ? new globalThis.Blob([bytes], { type: 'application/octet-stream' })
      : bytes;
  }
  if (description.kind === 'typed-array') {
    const bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    return typeof globalThis.Blob === 'function'
      ? new globalThis.Blob([bytes], { type: 'application/octet-stream' })
      : bytes;
  }
  return source;
}

function preparePackageAdmission(input, capNames) {
  const validation = validateWebGpuModelResourcePackage(input.package);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource package:\n${validation.errors.join('\n')}`);
  const modelPackage = defineWebGpuModelResourcePackage(input.package);
  if (!input.route || typeof input.route !== 'object') {
    throw new Error('model resource package loading requires a registered session route');
  }
  const hasSourceResource = modelPackage.resources.some(resource => !resource.chunkPlan);
  const hasChunkResource = modelPackage.resources.some(resource => resource.chunkPlan);
  if (hasSourceResource && typeof input.route.loadModelResourcesFromSource !== 'function') {
    throw new Error('source-backed model resource package loading requires route.loadModelResourcesFromSource');
  }
  if (
    hasChunkResource
    && typeof input.route.loadModelResourceChunksFromSources !== 'function'
  ) {
    throw new Error('chunk-backed model resource package loading requires route.loadModelResourceChunksFromSources');
  }
  const presentCaps = capNames.filter(name => input[name] != null);
  if (presentCaps.length > 0) {
    throw new Error(`model resource package loading is uncapped; ${capNames.join(', ')} are not supported`);
  }
  const sourceDescriptions = validateSources(modelPackage, input.sources);
  const sources = Object.create(null);
  for (const resource of modelPackage.resources) {
    const description = sourceDescriptions.get(resource.resourceId);
    sources[resource.resourceId] = resource.chunkPlan
      ? snapshotWebGpuModelResourceChunkSources(
        resource.chunkPlan,
        input.sources[resource.resourceId],
        description,
      )
      : snapshotOrdinarySource(input.sources[resource.resourceId], description);
  }
  Object.freeze(sources);
  return { modelPackage, sources, sourceDescriptions };
}

export async function loadWebGpuModelResourcePackageFromSources(input = {}) {
  const fetchOptionsSnapshot = snapshotWebGpuModelFetchOptions(input.fetchOptions, {
    label: 'model resource package',
    signalOwner: 'acquireResource',
  });
  input = Object.freeze({ ...input, fetchOptions: null });
  const { modelPackage, sources } = preparePackageAdmission(input, [
    'maxResources',
    'maxBytes',
    'maxProgressEvents',
  ]);
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
        const common = {
          cache: input.cache,
          fetch: input.fetch,
          fetchOptions: fetchOptionsSnapshot == null
            ? undefined
            : materializeWebGpuModelFetchOptions(fetchOptionsSnapshot),
          signal: input.signal,
          subtle: input.subtle,
          now: input.now,
          onProgress: event => recordProgress(resource, index, event),
        };
        lease = resource.chunkPlan
          ? await input.route.loadModelResourceChunksFromSources({
            ...common,
            plan: resource.chunkPlan,
            sources: sources[resource.resourceId],
          })
          : await input.route.loadModelResourcesFromSource({
            ...common,
            manifest: resource.manifest,
            source: sources[resource.resourceId],
            ownership: input.ownership,
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
            chunkReport: error?.chunkReport || null,
            authorityReport: error?.chunkReport || error?.acquisitionReport || null,
          },
          resources: resources.map(item => ({
            resourceId: item.resourceId,
            loadKind: item.loadKind,
            acquisitionReport: item.acquisitionReport,
            chunkReport: item.chunkReport,
            authorityReport: item.authorityReport,
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
        loadKind: resource.loadKind,
        manifest: resource.manifest,
        acquisitionReport: lease.acquisitionReport ?? null,
        chunkReport: lease.chunkReport ?? null,
        authorityReport: lease.chunkReport ?? lease.acquisitionReport,
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
        loadKind: item.loadKind,
        acquisitionReport: item.acquisitionReport,
        chunkReport: item.chunkReport,
        authorityReport: item.authorityReport,
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
      loadKind: resource.loadKind,
      acquisitionReport: resource.acquisitionReport,
      chunkReport: resource.chunkReport,
      authorityReport: resource.authorityReport,
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

export function createWebGpuModelResourcePackageLoader(input = {}) {
  if (!isNonEmptyString(input.loaderId)) {
    throw new Error('model resource package loaderId must be a non-empty string');
  }
  const fetchOptionsSnapshot = snapshotWebGpuModelFetchOptions(input.fetchOptions, {
    label: 'model resource package',
    signalOwner: 'acquireResource',
  });
  input = Object.freeze({ ...input, fetchOptions: null });
  const { modelPackage, sources, sourceDescriptions } = preparePackageAdmission(input, [
    'maxActiveResources',
    'maxActiveLeases',
    'maxAcquisitions',
    'maxBytes',
    'maxProgressEvents',
    'retentionLimit',
  ]);
  if (
    modelPackage.resources.some(resource => !resource.chunkPlan)
    && typeof input.route.loadResidentModelResources !== 'function'
  ) {
    throw new Error('source-backed model resource package child loading requires route.loadResidentModelResources');
  }
  const resourceById = new Map(modelPackage.resources.map(resource => [resource.resourceId, resource]));
  const resourceIndexById = new Map(modelPackage.resourceIds.map((resourceId, index) => [resourceId, index]));
  const now = typeof input.now === 'function'
    ? input.now
    : (() => globalThis.performance?.now?.() ?? Date.now());
  const state = {
    status: 'active',
    acquisitionCount: 0,
    residentReuseCount: 0,
    sourceLoadCount: 0,
    chunkLoadCount: 0,
    leaseSequence: 0,
    activeLeases: new Map(),
    closedAtMs: null,
  };

  function activeResourceIds() {
    const active = new Set([...state.activeLeases.values()].map(entry => entry.resourceId));
    return modelPackage.resourceIds.filter(resourceId => active.has(resourceId));
  }

  function snapshot() {
    return deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_PACKAGE_LOADER_SCHEMA,
      loaderId: input.loaderId,
      packageIdentity: modelPackage.identity,
      routeId: input.route.routeId,
      status: state.status,
      resourceIds: modelPackage.resourceIds,
      acquisitionCount: state.acquisitionCount,
      residentReuseCount: state.residentReuseCount,
      sourceLoadCount: state.sourceLoadCount,
      chunkLoadCount: state.chunkLoadCount,
      activeLeaseCount: state.activeLeases.size,
      activeResourceIds: activeResourceIds(),
      sourceMemoryBound: sourceMemoryBound(modelPackage),
      closedAtMs: state.closedAtMs,
    });
  }

  async function acquireResource(acquireInput = {}) {
    if (state.status !== 'active') throw new Error('model resource package resource loader is closed');
    if (!acquireInput || typeof acquireInput !== 'object' || Array.isArray(acquireInput)) {
      throw new Error('model resource package child acquisition input must be an object');
    }
    if (
      acquireInput.maxBytes != null
      || acquireInput.maxChunks != null
      || acquireInput.maxProgressEvents != null
    ) {
      throw new Error('model resource package child acquisition is uncapped; maxBytes, maxChunks, and maxProgressEvents are not supported');
    }
    const resourceId = acquireInput.resourceId ?? acquireInput.resource?.resourceId;
    if (!isNonEmptyString(resourceId) || !resourceById.has(resourceId)) {
      throw new Error(`unknown model package resource ${resourceId || '<missing>'}`);
    }
    throwIfAborted(acquireInput.signal);
    const resource = resourceById.get(resourceId);
    const resourceIndex = resourceIndexById.get(resourceId);
    const startedAtMs = now();
    const progress = [];
    const recordProgress = event => {
      const childEvent = deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_PACKAGE_PROGRESS_SCHEMA,
        sequence: progress.length + 1,
        packageIdentity: modelPackage.identity,
        resourceId,
        resourceIndex,
        resourceCount: modelPackage.resources.length,
        resourceEvent: event,
      });
      progress.push(childEvent);
      if (typeof input.onProgress === 'function') input.onProgress(childEvent);
      if (typeof acquireInput.onProgress === 'function') acquireInput.onProgress(childEvent);
    };
    let lease;
    let loadPath = resource.chunkPlan ? 'chunks' : 'source';
    try {
      const common = {
        cache: input.cache,
        fetch: input.fetch,
        fetchOptions: fetchOptionsSnapshot == null
          ? undefined
        : materializeWebGpuModelFetchOptions(fetchOptionsSnapshot),
        signal: acquireInput.signal,
        subtle: input.subtle,
        now: input.now,
        onProgress: recordProgress,
      };
      if (resource.chunkPlan) {
        lease = await input.route.loadModelResourceChunksFromSources({
          ...common,
          plan: resource.chunkPlan,
          sources: sources[resourceId],
        });
      } else {
        try {
          lease = await input.route.loadResidentModelResources({
            manifest: resource.manifest,
            signal: acquireInput.signal,
          });
          loadPath = 'resident';
        } catch (error) {
          if (
            error?.code !== 'WEBGPU_RESOURCE_NOT_RESIDENT'
            || (error.cleanup?.failedReleaseCount ?? 0) > 0
          ) throw error;
        }
        if (!lease) lease = await input.route.loadModelResourcesFromSource({
          ...common,
          manifest: resource.manifest,
          source: sources[resourceId],
          ownership: input.ownership,
        });
      }
    } catch (error) {
      const acquisitionReport = error?.acquisitionReport ?? null;
      const chunkReport = error?.chunkReport ?? null;
      const residentReuseReport = error?.residentReuseReport ?? null;
      const report = deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_PACKAGE_CHILD_REPORT_SCHEMA,
        status: error?.name === 'AbortError' ? 'canceled' : 'failed',
        loaderId: input.loaderId,
        packageIdentity: modelPackage.identity,
        routeId: input.route.routeId,
        resourceId,
        resourceIndex,
        loadKind: resource.loadKind,
        loadPath,
        phaseId: acquireInput.phaseId ?? null,
        purpose: acquireInput.purpose ?? null,
        startedAtMs,
        settledAtMs: now(),
        sourceDescription: sourceDescriptions.get(resourceId),
        acquisitionReport,
        chunkReport,
        residentReuseReport,
        authorityReport: residentReuseReport ?? chunkReport ?? acquisitionReport,
        progress,
        failure: {
          name: error?.name || 'Error',
          message: String(error?.message || error),
        },
      });
      throw errorWithPackageChildReport(error, report);
    }

    state.acquisitionCount += 1;
    if (loadPath === 'resident') state.residentReuseCount += 1;
    if (loadPath === 'source') state.sourceLoadCount += 1;
    if (loadPath === 'chunks') state.chunkLoadCount += 1;
    state.leaseSequence += 1;
    const childLeaseId = `${encodeURIComponent(input.loaderId)}:${state.leaseSequence}`;
    const acquisitionReport = lease.acquisitionReport ?? null;
    const chunkReport = lease.chunkReport ?? null;
    const residentReuseReport = lease.residentReuseReport ?? null;
    const report = deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_PACKAGE_CHILD_REPORT_SCHEMA,
      status: 'loaded',
      loaderId: input.loaderId,
      packageIdentity: modelPackage.identity,
      routeId: input.route.routeId,
      resourceId,
      resourceIndex,
      loadKind: resource.loadKind,
      loadPath,
      phaseId: acquireInput.phaseId ?? null,
      purpose: acquireInput.purpose ?? null,
      startedAtMs,
      settledAtMs: now(),
      sourceDescription: sourceDescriptions.get(resourceId),
      acquisitionReport,
      chunkReport,
      residentReuseReport,
      authorityReport: residentReuseReport ?? chunkReport ?? acquisitionReport,
      progress,
      failure: null,
    });
    const activeEntry = { resourceId, lease };
    state.activeLeases.set(childLeaseId, activeEntry);
    let terminal = false;
    return Object.freeze({
      schema: WEBGPU_MODEL_RESOURCE_PACKAGE_CHILD_LEASE_SCHEMA,
      childLeaseId,
      loaderId: input.loaderId,
      packageIdentity: modelPackage.identity,
      packageId: modelPackage.packageId,
      modelId: modelPackage.modelId,
      revision: modelPackage.revision,
      routeId: input.route.routeId,
      resourceId,
      loadKind: resource.loadKind,
      manifest: resource.manifest,
      allocations: lease.allocations,
      tensors: lease.tensors,
      acquisitionReport,
      chunkReport,
      residentReuseReport,
      authorityReport: residentReuseReport ?? chunkReport ?? acquisitionReport,
      report,
      release() {
        if (terminal) {
          return deepFreeze({
            schema: WEBGPU_MODEL_RESOURCE_PACKAGE_CHILD_LEASE_SCHEMA,
            childLeaseId,
            loaderId: input.loaderId,
            packageIdentity: modelPackage.identity,
            routeId: input.route.routeId,
            resourceId,
            status: 'already-released',
          });
        }
        const release = lease.release();
        if (release != null && typeof release.then === 'function') {
          throw new Error(`model package resource ${resourceId} lease release must complete synchronously`);
        }
        const status = release?.status ?? 'released';
        if (status === 'release-failed') {
          return deepFreeze({
            schema: WEBGPU_MODEL_RESOURCE_PACKAGE_CHILD_LEASE_SCHEMA,
            childLeaseId,
            loaderId: input.loaderId,
            packageIdentity: modelPackage.identity,
            routeId: input.route.routeId,
            resourceId,
            status,
            underlyingRelease: release ?? null,
          });
        }
        if (status !== 'released' && status !== 'already-released' && status !== 'invalidated') {
          throw new Error(`model package resource ${resourceId} lease release returned unsupported status ${status}`);
        }
        terminal = true;
        state.activeLeases.delete(childLeaseId);
        return deepFreeze({
          schema: WEBGPU_MODEL_RESOURCE_PACKAGE_CHILD_LEASE_SCHEMA,
          childLeaseId,
          loaderId: input.loaderId,
          packageIdentity: modelPackage.identity,
          routeId: input.route.routeId,
          resourceId,
          status,
          underlyingRelease: release ?? null,
        });
      },
    });
  }

  function close() {
    if (state.status === 'closed') {
      return deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_PACKAGE_LOADER_SCHEMA,
        loaderId: input.loaderId,
        packageIdentity: modelPackage.identity,
        routeId: input.route.routeId,
        status: 'already-closed',
        activeLeaseCount: state.activeLeases.size,
        activeResourceIds: activeResourceIds(),
        closedAtMs: state.closedAtMs,
      });
    }
    state.status = 'closed';
    state.closedAtMs = now();
    return deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_PACKAGE_LOADER_SCHEMA,
      loaderId: input.loaderId,
      packageIdentity: modelPackage.identity,
      routeId: input.route.routeId,
      status: state.activeLeases.size > 0 ? 'closed-with-active-leases' : 'closed',
      activeLeaseCount: state.activeLeases.size,
      activeResourceIds: activeResourceIds(),
      closedAtMs: state.closedAtMs,
    });
  }

  return Object.freeze({
    schema: WEBGPU_MODEL_RESOURCE_PACKAGE_LOADER_SCHEMA,
    loaderId: input.loaderId,
    identity: `${modelPackage.identity}#loader:${encodeURIComponent(input.loaderId)}@${encodeURIComponent(input.route.routeId)}`,
    packageIdentity: modelPackage.identity,
    packageId: modelPackage.packageId,
    modelId: modelPackage.modelId,
    revision: modelPackage.revision,
    routeId: input.route.routeId,
    package: modelPackage,
    resourceIds: modelPackage.resourceIds,
    acquireResource,
    snapshot,
    close,
  });
}
