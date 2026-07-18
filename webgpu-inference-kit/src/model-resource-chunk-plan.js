import {
  WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA,
  WEBGPU_MODEL_RESOURCE_SHARING_POLICIES,
  WEBGPU_MODEL_RESOURCE_TENSOR_SCHEMA,
  validateWebGpuModelResourceManifest,
} from './model-resource-manifest.js';
import {
  acquireWebGpuVerifiedResourceSource,
  describeWebGpuModelResourceSource,
} from './model-resource-source.js';
import { WEBGPU_RESOURCE_CANCELLATION_MODES } from './resource-factory.js';

export const WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_SCHEMA = 'kaminos.webgpu-model-resource-chunk-plan.v0';
export const WEBGPU_MODEL_RESOURCE_CHUNK_CUSTODY_SCHEMA = 'kaminos.webgpu-model-resource-chunk-custody.v0';
export const WEBGPU_MODEL_RESOURCE_CHUNK_VERIFICATION_SCHEMA = 'kaminos.webgpu-model-resource-chunk-verification.v0';
export const WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_VERIFICATION_SCHEMA = 'kaminos.webgpu-model-resource-chunk-plan-verification.v0';
export const WEBGPU_MODEL_RESOURCE_CHUNK_SOURCE_REPORT_SCHEMA = 'kaminos.webgpu-model-resource-chunk-source-report.v0';
export const WEBGPU_MODEL_RESOURCE_CHUNK_LOAD_REPORT_SCHEMA = 'kaminos.webgpu-model-resource-chunk-load-report.v0';
export const WEBGPU_MODEL_RESOURCE_CHUNK_PROGRESS_SCHEMA = 'kaminos.webgpu-model-resource-chunk-progress.v0';
export const WEBGPU_MODEL_RESOURCE_CHUNK_ALLOCATION_PROVENANCE_SCHEMA = 'kaminos.webgpu-model-resource-chunk-allocation-provenance.v0';

const chunkCustody = new WeakMap();
const chunkAllocationProvenance = new WeakMap();

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value != null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function abortError(signal) {
  const error = new Error(String(signal?.reason || 'model resource chunk load aborted'));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function byteView(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    if (typeof SharedArrayBuffer !== 'undefined' && data.buffer instanceof SharedArrayBuffer) {
      throw new Error('model resource chunk must not use SharedArrayBuffer');
    }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error('model resource chunk must be an ArrayBuffer or typed array view');
}

function chunkIdentity(chunk) {
  return `kaminos:model-resource-chunk:sha256:${chunk.sha256}:bytes:${chunk.byteLength}`;
}

function chunkPhysicalResourceId(allocation, chunks) {
  const coverage = chunks
    .map(chunk => `${chunk.byteOffset}:${chunk.byteLength}:${chunk.sha256}`)
    .join(',');
  return `kaminos:model-resource-chunks:${allocation.byteLength}:${allocation.usage}:${coverage}`;
}

function chunkSemanticResourceId(physicalResourceId, manifestAllocation) {
  return `${physicalResourceId}:manifest-semantic:${encodeURIComponent(manifestAllocation.semanticResourceId)}`;
}

function planIdentity(plan) {
  const allocations = plan.allocations.map(allocation => {
    const chunks = allocation.chunks.map(chunk => (
      `${encodeURIComponent(chunk.chunkId)}@${chunk.byteOffset}:${encodeURIComponent(chunk.identity)}`
    )).join(',');
    return `${encodeURIComponent(allocation.allocationId)}=${encodeURIComponent(allocation.semanticResourceId)}[${chunks}]`;
  }).join('&');
  return `${encodeURIComponent(plan.planId)}:${encodeURIComponent(plan.manifest.identity)}#allocations:${allocations}`;
}

function sourceMemoryBound(plan) {
  return deepFreeze({
    authority: 'sequential-chunk-acquisition-declared-byte-length',
    largestChunkByteLength: plan.largestChunkByteLength,
    totalSourceByteLength: plan.totalSourceByteLength,
    residual: 'one-chunk-source-acquisition-may-retain-multiple-host-representations',
  });
}

export function validateWebGpuModelResourceChunkPlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, errors: ['model resource chunk plan must be an object'] };
  }
  if (plan.schema !== WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_SCHEMA}`);
  }
  if (!isNonEmptyString(plan.planId)) errors.push('planId must be a non-empty string');
  if (plan.maxChunks != null || plan.maxBytes != null || plan.retentionLimit != null) {
    errors.push('model resource chunk plans are uncapped; maxChunks, maxBytes, and retentionLimit are not supported');
  }
  const manifestValidation = validateWebGpuModelResourceManifest(plan.manifest);
  if (!manifestValidation.ok) {
    errors.push(...manifestValidation.errors.map(error => `manifest: ${error}`));
    return { ok: false, errors };
  }
  if (!Array.isArray(plan.allocations) || plan.allocations.length !== plan.manifest.allocations.length) {
    errors.push('allocations must match every manifest allocation in declaration order');
    return { ok: false, errors };
  }

  const chunkIds = new Set();
  let totalSourceByteLength = 0;
  let largestChunkByteLength = 0;
  plan.allocations.forEach((allocation, allocationIndex) => {
    const manifestAllocation = plan.manifest.allocations[allocationIndex];
    const prefix = `allocations[${allocationIndex}]`;
    if (!allocation || typeof allocation !== 'object' || Array.isArray(allocation)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (allocation.allocationId !== manifestAllocation.allocationId) {
      errors.push(`${prefix}.allocationId must match manifest allocation declaration order`);
    }
    if (allocation.byteLength !== manifestAllocation.byteLength) {
      errors.push(`${prefix}.byteLength must match manifest allocation byteLength`);
    }
    if (allocation.usage !== manifestAllocation.usage) {
      errors.push(`${prefix}.usage must match manifest allocation usage`);
    }
    if (!Array.isArray(allocation.chunks) || allocation.chunks.length === 0) {
      errors.push(`${prefix}.chunks must be a non-empty array`);
      return;
    }
    let expectedOffset = 0;
    allocation.chunks.forEach((chunk, chunkIndex) => {
      const chunkPrefix = `${prefix}.chunks[${chunkIndex}]`;
      if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
        errors.push(`${chunkPrefix} must be an object`);
        return;
      }
      if (!isNonEmptyString(chunk.chunkId)) {
        errors.push(`${chunkPrefix}.chunkId must be a non-empty string`);
      } else if (chunkIds.has(chunk.chunkId)) {
        errors.push(`duplicate model resource chunkId ${chunk.chunkId}`);
      } else {
        chunkIds.add(chunk.chunkId);
      }
      if (!Number.isSafeInteger(chunk.byteOffset) || chunk.byteOffset < 0 || chunk.byteOffset % 4 !== 0) {
        errors.push(`${chunkPrefix}.byteOffset must be a non-negative 4-byte-aligned safe integer`);
      } else if (chunk.byteOffset !== expectedOffset) {
        errors.push(`${chunkPrefix}.byteOffset must provide contiguous allocation coverage at ${expectedOffset}`);
      }
      if (!Number.isSafeInteger(chunk.byteLength) || chunk.byteLength <= 0 || chunk.byteLength % 4 !== 0) {
        errors.push(`${chunkPrefix}.byteLength must be a positive 4-byte-aligned safe integer`);
      }
      if (typeof chunk.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(chunk.sha256)) {
        errors.push(`${chunkPrefix}.sha256 must be a lowercase 64-character SHA-256 digest`);
      }
      if (Number.isSafeInteger(chunk.byteLength) && chunk.byteLength > 0) {
        expectedOffset = Number.isSafeInteger(chunk.byteOffset)
          ? chunk.byteOffset + chunk.byteLength
          : expectedOffset + chunk.byteLength;
        totalSourceByteLength += chunk.byteLength;
        if (!Number.isSafeInteger(totalSourceByteLength)) {
          errors.push('total model resource chunk bytes exceed safe integer range');
        }
        largestChunkByteLength = Math.max(largestChunkByteLength, chunk.byteLength);
      }
      if (isNonEmptyString(chunk.chunkId) && chunk.identity !== chunkIdentity(chunk)) {
        errors.push(`${chunkPrefix}.identity must bind chunk SHA-256 and byteLength`);
      }
    });
    if (expectedOffset !== manifestAllocation.byteLength) {
      errors.push(`${prefix}.chunks must provide exact contiguous coverage of ${manifestAllocation.byteLength} bytes`);
    }
    if (allocation.chunks.every(chunk => chunk && typeof chunk === 'object' && !Array.isArray(chunk))) {
      const expectedPhysical = chunkPhysicalResourceId(manifestAllocation, allocation.chunks);
      const expectedSemantic = chunkSemanticResourceId(expectedPhysical, manifestAllocation);
      const expectedResource = plan.manifest.resourceSharing.policy
        === WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.contentAddressedPhysicalDedupe
        ? expectedPhysical
        : expectedSemantic;
      if (allocation.physicalResourceId !== expectedPhysical) {
        errors.push(`${prefix}.physicalResourceId must bind ordered chunk coverage`);
      }
      if (allocation.semanticResourceId !== expectedSemantic) {
        errors.push(`${prefix}.semanticResourceId must bind chunk coverage and manifest semantics`);
      }
      if (allocation.resourceId !== expectedResource) {
        errors.push(`${prefix}.resourceId must match the manifest resourceSharing policy`);
      }
    }
  });

  if (!Array.isArray(plan.chunkIds)) {
    errors.push('chunkIds must be an array matching chunks in declaration order');
  } else if (
    plan.chunkIds.length !== chunkIds.size
    || plan.chunkIds.some((chunkId, index) => chunkId !== [...chunkIds][index])
  ) {
    errors.push('chunkIds must match chunks in declaration order');
  }
  if (!Number.isSafeInteger(plan.totalSourceByteLength) || plan.totalSourceByteLength <= 0) {
    errors.push('totalSourceByteLength must be a positive safe integer');
  } else if (plan.totalSourceByteLength !== totalSourceByteLength) {
    errors.push('totalSourceByteLength must equal all declared chunk bytes');
  }
  if (!Number.isSafeInteger(plan.largestChunkByteLength) || plan.largestChunkByteLength <= 0) {
    errors.push('largestChunkByteLength must be a positive safe integer');
  } else if (plan.largestChunkByteLength !== largestChunkByteLength) {
    errors.push('largestChunkByteLength must equal the largest declared chunk');
  }
  if (errors.length === 0 && plan.identity !== planIdentity(plan)) {
    errors.push('identity must bind planId, manifest identity, chunk coverage, and allocation semantics');
  }
  return { ok: errors.length === 0, errors };
}

export function defineWebGpuModelResourceChunkPlan(input = {}) {
  if (input.maxChunks != null || input.maxBytes != null || input.retentionLimit != null) {
    throw new Error('model resource chunk plans are uncapped; maxChunks, maxBytes, and retentionLimit are not supported');
  }
  const manifest = input.manifest;
  const manifestValidation = validateWebGpuModelResourceManifest(manifest);
  if (!manifestValidation.ok) {
    throw new Error(`invalid WebGPU model resource manifest:\n${manifestValidation.errors.join('\n')}`);
  }
  const inputAllocations = input.allocations || [];
  const allocations = inputAllocations.map((allocation, allocationIndex) => {
    const manifestAllocation = manifest.allocations[allocationIndex];
    const chunks = (allocation?.chunks || []).map(chunk => {
      const normalized = {
        chunkId: chunk?.chunkId,
        byteOffset: chunk?.byteOffset,
        byteLength: chunk?.byteLength,
        sha256: typeof chunk?.sha256 === 'string' ? chunk.sha256.toLowerCase() : chunk?.sha256,
      };
      return { ...normalized, identity: chunkIdentity(normalized) };
    });
    const physicalResourceId = manifestAllocation
      ? chunkPhysicalResourceId(manifestAllocation, chunks)
      : null;
    const semanticResourceId = manifestAllocation
      ? chunkSemanticResourceId(physicalResourceId, manifestAllocation)
      : null;
    return {
      allocationId: allocation?.allocationId,
      byteLength: manifestAllocation?.byteLength,
      usage: manifestAllocation?.usage,
      chunks,
      resourceId: manifest.resourceSharing.policy
        === WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.contentAddressedPhysicalDedupe
        ? physicalResourceId
        : semanticResourceId,
      physicalResourceId,
      semanticResourceId,
    };
  });
  const allChunks = allocations.flatMap(allocation => allocation.chunks);
  const plan = {
    schema: WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_SCHEMA,
    planId: input.planId,
    manifest,
    allocations,
    chunkIds: allChunks.map(chunk => chunk.chunkId),
    totalSourceByteLength: allChunks.reduce((total, chunk) => total + (chunk.byteLength || 0), 0),
    largestChunkByteLength: allChunks.reduce((largest, chunk) => Math.max(largest, chunk.byteLength || 0), 0),
  };
  plan.identity = planIdentity(plan);
  const validation = validateWebGpuModelResourceChunkPlan(plan);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource chunk plan:\n${validation.errors.join('\n')}`);
  return deepFreeze(plan);
}

async function prepareChunk(plan, chunk, source, options = {}) {
  const ownership = options.ownership || 'copy';
  if (ownership !== 'copy' && ownership !== 'transfer') {
    throw new Error('model resource chunk ownership must be copy or transfer');
  }
  throwIfAborted(options.signal);
  let bytes;
  if (ownership === 'transfer') {
    if (!(source instanceof ArrayBuffer)) throw new Error('chunk transfer ownership requires a full ArrayBuffer');
    if (typeof globalThis.structuredClone !== 'function') {
      throw new Error('structuredClone with ArrayBuffer transfer is required for chunk transfer ownership');
    }
    bytes = new Uint8Array(globalThis.structuredClone(source, { transfer: [source] }));
  } else {
    bytes = Uint8Array.from(byteView(source));
  }
  if (bytes.byteLength !== chunk.byteLength) {
    throw new Error(`model resource chunk ${chunk.chunkId} byteLength ${bytes.byteLength} does not match ${chunk.byteLength}`);
  }
  const subtle = options.subtle || globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('Web Crypto subtle.digest is required to verify model resource chunks');
  }
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  throwIfAborted(options.signal);
  const effectiveSha256 = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (effectiveSha256 !== chunk.sha256) {
    throw new Error(`model resource chunk ${chunk.chunkId} SHA-256 ${effectiveSha256} does not match ${chunk.sha256}`);
  }
  const verification = deepFreeze({
    schema: WEBGPU_MODEL_RESOURCE_CHUNK_VERIFICATION_SCHEMA,
    status: 'verified',
    algorithm: 'SHA-256',
    planIdentity: plan.identity,
    manifestIdentity: plan.manifest.identity,
    chunkIdentity: chunk.identity,
    chunkId: chunk.chunkId,
    expectedByteLength: chunk.byteLength,
    effectiveByteLength: bytes.byteLength,
    expectedSha256: chunk.sha256,
    effectiveSha256,
    byteCustody: `loader-owned-${ownership}-before-verification`,
  });
  const state = { bytes, released: false };
  let handle;
  handle = Object.freeze({
    schema: WEBGPU_MODEL_RESOURCE_CHUNK_CUSTODY_SCHEMA,
    identity: chunk.identity,
    chunkId: chunk.chunkId,
    ownership,
    byteLength: bytes.byteLength,
    verification,
    snapshot() {
      return deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_CHUNK_CUSTODY_SCHEMA,
        identity: chunk.identity,
        chunkId: chunk.chunkId,
        ownership,
        byteLength: state.bytes?.byteLength || 0,
        status: state.released ? 'released' : 'owned',
        verification,
      });
    },
    release() {
      if (state.released) {
        return deepFreeze({
          schema: WEBGPU_MODEL_RESOURCE_CHUNK_CUSTODY_SCHEMA,
          identity: chunk.identity,
          chunkId: chunk.chunkId,
          status: 'already-released',
          releasedByteLength: 0,
        });
      }
      const releasedByteLength = state.bytes.byteLength;
      state.bytes = null;
      state.released = true;
      return deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_CHUNK_CUSTODY_SCHEMA,
        identity: chunk.identity,
        chunkId: chunk.chunkId,
        status: 'released',
        releasedByteLength,
      });
    },
  });
  chunkCustody.set(handle, state);
  return handle;
}

function expectedChunk(plan, chunk) {
  return {
    identity: chunk.identity,
    identityField: 'chunkIdentity',
    manifestIdentity: plan.manifest.identity,
    reportSchema: WEBGPU_MODEL_RESOURCE_CHUNK_SOURCE_REPORT_SCHEMA,
    validationPhase: 'chunk-validation',
    byteLength: chunk.byteLength,
    sha256: chunk.sha256,
    authority: 'source-bytes-verified-against-declared-chunk-no-network-or-cache-freshness-beyond-effective-read-claim',
    validate() {
      const validation = validateWebGpuModelResourceChunkPlan(plan);
      if (!validation.ok) throw new Error(`invalid WebGPU model resource chunk plan:\n${validation.errors.join('\n')}`);
      if (!plan.chunkIds.includes(chunk.chunkId)) throw new Error(`unknown model resource chunk ${chunk.chunkId}`);
    },
    prepare(buffer, prepareOptions) {
      return prepareChunk(plan, chunk, buffer, prepareOptions);
    },
  };
}

export function preflightWebGpuModelResourceChunkSources(plan, sources) {
  const validation = validateWebGpuModelResourceChunkPlan(plan);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource chunk plan:\n${validation.errors.join('\n')}`);
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    throw new Error('model resource chunk sources must be an object keyed by chunkId');
  }
  const expected = new Set(plan.chunkIds);
  const descriptions = new Map();
  for (const chunkId of expected) {
    if (!Object.hasOwn(sources, chunkId) || sources[chunkId] == null) {
      throw new Error(`missing source for model resource chunk ${chunkId}`);
    }
    descriptions.set(chunkId, describeWebGpuModelResourceSource(sources[chunkId]));
  }
  for (const chunkId of Object.keys(sources)) {
    if (!expected.has(chunkId)) throw new Error(`unknown model resource chunk source ${chunkId}`);
  }
  if (plan.chunkIds.length > 1) {
    for (const [chunkId, description] of descriptions) {
      if (description.kind === 'array-buffer' || description.kind === 'typed-array') {
        throw new Error(
          `multi-chunk model resource source ${chunkId} uses mutable bytes; wrap direct bytes in an immutable Blob or use a URL, Request, or Response source`,
        );
      }
    }
  }
  return descriptions;
}

export function snapshotWebGpuModelResourceChunkSources(plan, sources, descriptions = null) {
  const sourceDescriptions = descriptions ?? preflightWebGpuModelResourceChunkSources(plan, sources);
  const snapshot = Object.create(null);
  for (const chunkId of plan.chunkIds) {
    const source = sources[chunkId];
    const description = sourceDescriptions.get(chunkId);
    if (plan.chunkIds.length === 1 && description.kind === 'array-buffer') {
      const bytes = source.slice(0);
      snapshot[chunkId] = typeof globalThis.Blob === 'function'
        ? new globalThis.Blob([bytes], { type: 'application/octet-stream' })
        : bytes;
    } else if (plan.chunkIds.length === 1 && description.kind === 'typed-array') {
      const bytes = Uint8Array.from(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
      snapshot[chunkId] = typeof globalThis.Blob === 'function'
        ? new globalThis.Blob([bytes], { type: 'application/octet-stream' })
        : bytes;
    } else {
      snapshot[chunkId] = source;
    }
  }
  return Object.freeze(snapshot);
}

function assertRoute(route) {
  if (!route || typeof route !== 'object' || !isNonEmptyString(route.routeId)) {
    throw new Error('chunk loading requires a registered session route');
  }
  if (!route.runtime || typeof route.runtime.createBuffer !== 'function' || typeof route.runtime.writeBuffer !== 'function') {
    throw new Error('chunk loading route runtime must expose createBuffer and writeBuffer');
  }
  if (!route.residency || typeof route.residency.acquireOrCreate !== 'function') {
    throw new Error('chunk loading route residency must expose acquireOrCreate');
  }
}

function releaseLeases(leases) {
  const releases = [];
  const failures = [];
  for (const lease of [...leases].reverse()) {
    try {
      const release = lease.release();
      releases.push(release);
      if (release?.status === 'release-failed') {
        failures.push({
          resourceId: lease.resourceId,
          message: String(release.message || 'lease release failed'),
        });
      }
    } catch (error) {
      failures.push({ resourceId: lease.resourceId, message: String(error?.message || error) });
    }
  }
  const invalidatedLeaseCount = releases.filter(release => release?.status === 'invalidated').length;
  const releasedLeaseCount = releases.filter(release => (
    release?.status == null
    || release.status === 'released'
    || release.status === 'already-released'
  )).length;
  return deepFreeze({
    releasedLeaseCount,
    invalidatedLeaseCount,
    failedReleaseCount: failures.length,
    releases,
    failures,
  });
}

function errorWithChunkReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!Object.hasOwn(error, 'chunkReport')) {
    try {
      error.chunkReport = report;
      if (error.chunkReport === report) return error;
    } catch {}
  }
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.chunkReport = report;
  return wrapped;
}

export async function loadWebGpuModelResourceChunksFromSources(input = {}) {
  const validation = validateWebGpuModelResourceChunkPlan(input.plan);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource chunk plan:\n${validation.errors.join('\n')}`);
  const plan = defineWebGpuModelResourceChunkPlan(input.plan);
  assertRoute(input.route);
  if (input.maxChunks != null || input.maxBytes != null || input.maxProgressEvents != null) {
    throw new Error('model resource chunk loading is uncapped; maxChunks, maxBytes, and maxProgressEvents are not supported');
  }
  const sourceDescriptions = preflightWebGpuModelResourceChunkSources(plan, input.sources);
  const sources = snapshotWebGpuModelResourceChunkSources(plan, input.sources, sourceDescriptions);
  throwIfAborted(input.signal);

  const now = typeof input.now === 'function'
    ? input.now
    : (() => globalThis.performance?.now?.() ?? Date.now());
  const startedAtMs = now();
  const progress = [];
  const leases = [];
  const loadedAllocations = [];
  let failedAllocationId = null;
  let failedChunkId = null;
  let failedChunkReport = null;

  function recordProgress(allocation, chunk, allocationIndex, chunkIndex, event) {
    const wrapped = deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_CHUNK_PROGRESS_SCHEMA,
      sequence: progress.length + 1,
      planIdentity: plan.identity,
      manifestIdentity: plan.manifest.identity,
      allocationId: allocation.allocationId,
      allocationIndex,
      chunkId: chunk.chunkId,
      chunkIndex,
      chunkCount: plan.chunkIds.length,
      sourceEvent: event,
    });
    progress.push(wrapped);
    if (typeof input.onProgress === 'function') input.onProgress(wrapped);
  }

  try {
    for (let allocationIndex = 0; allocationIndex < plan.allocations.length; allocationIndex += 1) {
      throwIfAborted(input.signal);
      const allocation = plan.allocations[allocationIndex];
      const manifestAllocation = plan.manifest.allocations[allocationIndex];
      const chunkReports = [];
      let createdByRequest = false;
      let lease;
      try {
        const sharedPhysical = plan.manifest.resourceSharing.policy
          === WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.contentAddressedPhysicalDedupe;
        lease = await input.route.residency.acquireOrCreate({
          resourceId: allocation.resourceId,
          declaredBytes: allocation.byteLength,
          kind: 'chunk-authenticated-model-weight-buffer',
          metadata: {
            resourceSharingPolicy: plan.manifest.resourceSharing.policy,
            physicalResourceId: allocation.physicalResourceId,
            chunkByteAuthority: 'ordered-allocation-relative-sha256-coverage',
            byteLength: allocation.byteLength,
            usage: allocation.usage,
            ...(sharedPhysical ? {} : {
              chunkPlanIdentity: plan.identity,
              manifestIdentity: plan.manifest.identity,
              semanticResourceId: allocation.semanticResourceId,
              allocationId: allocation.allocationId,
              chunkIds: allocation.chunks.map(chunk => chunk.chunkId),
            }),
          },
          signal: input.signal,
          cancellationMode: WEBGPU_RESOURCE_CANCELLATION_MODES.creatorSettlement,
          async create({ signal: flightSignal }) {
            createdByRequest = true;
            let buffer;
            try {
              throwIfAborted(flightSignal);
              buffer = input.route.runtime.createBuffer({
                label: `${plan.manifest.modelId}@${plan.manifest.revision}:${allocation.allocationId}:chunks`,
                size: allocation.byteLength,
                usage: allocation.usage,
              });
              for (let chunkIndex = 0; chunkIndex < allocation.chunks.length; chunkIndex += 1) {
                const chunk = allocation.chunks[chunkIndex];
                failedAllocationId = allocation.allocationId;
                failedChunkId = chunk.chunkId;
                let acquired;
                try {
                  acquired = await acquireWebGpuVerifiedResourceSource(
                    expectedChunk(plan, chunk),
                    sources[chunk.chunkId],
                    {
                      cache: input.cache,
                      fetch: input.fetch,
                      fetchOptions: input.fetchOptions,
                      ownership: 'transfer',
                      signal: flightSignal,
                      subtle: input.subtle,
                      now: input.now,
                      onProgress: event => recordProgress(
                        allocation,
                        chunk,
                        allocationIndex,
                        chunkIndex,
                        event,
                      ),
                    },
                  );
                } catch (error) {
                  failedChunkReport = error?.report || null;
                  try {
                    error.chunkAllocationId = allocation.allocationId;
                    error.chunkId = chunk.chunkId;
                    error.chunkSourceReport = failedChunkReport;
                  } catch {}
                  throw error;
                }
                try {
                  const custody = chunkCustody.get(acquired.bundle);
                  if (!custody || custody.released) {
                    throw new Error(`model resource chunk custody ${chunk.chunkId} is unavailable`);
                  }
                  input.route.runtime.writeBuffer(buffer, custody.bytes, chunk.byteOffset);
                  chunkReports.push(deepFreeze({
                    chunkId: chunk.chunkId,
                    byteOffset: chunk.byteOffset,
                    byteLength: chunk.byteLength,
                    acquisitionReport: acquired.report,
                    verification: acquired.bundle.verification,
                  }));
                } finally {
                  acquired.bundle.release();
                }
              }
              failedAllocationId = allocation.allocationId;
              failedChunkId = null;
              failedChunkReport = null;
              throwIfAborted(flightSignal);
              failedAllocationId = null;
              chunkAllocationProvenance.set(buffer, deepFreeze({
                schema: WEBGPU_MODEL_RESOURCE_CHUNK_ALLOCATION_PROVENANCE_SCHEMA,
                status: 'verified-creator-publication',
                planIdentity: plan.identity,
                manifestIdentity: plan.manifest.identity,
                allocationId: allocation.allocationId,
                resourceId: allocation.resourceId,
                chunks: [...chunkReports],
              }));
              return buffer;
            } catch (error) {
              try {
                if (!error.chunkAllocationId) error.chunkAllocationId = allocation.allocationId;
                if (!error.chunkId && failedChunkId) error.chunkId = failedChunkId;
                if (!error.chunkSourceReport && failedChunkReport) error.chunkSourceReport = failedChunkReport;
                if (!error.completedChunkReports) error.completedChunkReports = [...chunkReports];
              } catch {}
              if (buffer && typeof buffer.destroy === 'function') buffer.destroy();
              throw error;
            }
          },
          dispose(buffer) {
            if (typeof buffer.destroy === 'function') buffer.destroy();
          },
        });
      } catch (error) {
        const cleanup = releaseLeases(leases);
        const failedAllocationChunks = error?.completedChunkReports || chunkReports;
        const report = deepFreeze({
          schema: WEBGPU_MODEL_RESOURCE_CHUNK_LOAD_REPORT_SCHEMA,
          status: error?.name === 'AbortError' ? 'canceled' : 'failed',
          planIdentity: plan.identity,
          manifestIdentity: plan.manifest.identity,
          routeId: input.route.routeId,
          startedAtMs,
          settledAtMs: now(),
          failedAllocationId: error?.chunkAllocationId || failedAllocationId || allocation.allocationId,
          failedChunkId: error?.chunkId || failedChunkId,
          failedChunkReport: error?.chunkSourceReport || failedChunkReport,
          failedAllocation: {
            allocationId: error?.chunkAllocationId || failedAllocationId || allocation.allocationId,
            resourceId: allocation.resourceId,
            status: 'failed-before-publication',
            chunks: failedAllocationChunks,
          },
          failure: { name: error?.name || 'Error', message: String(error?.message || error) },
          allocations: loadedAllocations.map(item => item.report),
          progress,
          sourceMemoryBound: sourceMemoryBound(plan),
          cleanup,
        });
        throw errorWithChunkReport(error, report);
      }
      leases.push(lease);
      const provenance = chunkAllocationProvenance.get(lease.resource);
      if (!provenance) {
        lease.release();
        leases.pop();
        throw new Error(`chunk-authenticated resource ${allocation.resourceId} has no verification provenance`);
      }
      const allocationReport = deepFreeze({
        allocationId: allocation.allocationId,
        resourceId: allocation.resourceId,
        status: createdByRequest ? 'created-from-verified-chunks' : 'resident-or-flight-reused',
        chunks: provenance.chunks,
        provenance,
      });
      loadedAllocations.push({ allocation, manifestAllocation, lease, report: allocationReport });
    }
  } catch (error) {
    if (error?.chunkReport) throw error;
    const cleanup = releaseLeases(leases);
    const report = deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_CHUNK_LOAD_REPORT_SCHEMA,
      status: error?.name === 'AbortError' ? 'canceled' : 'failed',
      planIdentity: plan.identity,
      manifestIdentity: plan.manifest.identity,
      routeId: input.route.routeId,
      startedAtMs,
      settledAtMs: now(),
      failedAllocationId,
      failedChunkId,
      failedChunkReport,
      failedAllocation: null,
      failure: { name: error?.name || 'Error', message: String(error?.message || error) },
      allocations: loadedAllocations.map(item => item.report),
      progress,
      sourceMemoryBound: sourceMemoryBound(plan),
      cleanup,
    });
    throw errorWithChunkReport(error, report);
  }

  const allocations = loadedAllocations.map(({ allocation, manifestAllocation, lease }) => Object.freeze({
    allocationId: allocation.allocationId,
    resourceId: allocation.resourceId,
    physicalResourceId: allocation.physicalResourceId,
    semanticResourceId: allocation.semanticResourceId,
    semanticLeaseId: `${allocation.semanticResourceId}:lease:${lease.leaseId}`,
    resourceSharingPolicy: plan.manifest.resourceSharing.policy,
    leaseId: lease.leaseId,
    generation: lease.generation,
    byteOffset: manifestAllocation.byteOffset,
    byteLength: allocation.byteLength,
    usage: allocation.usage,
    buffer: lease.resource,
  }));
  const allocationById = new Map(allocations.map(allocation => [allocation.allocationId, allocation]));
  const planAllocationById = new Map(plan.allocations.map(allocation => [allocation.allocationId, allocation]));
  const tensors = Object.create(null);
  for (const manifestAllocation of plan.manifest.allocations) {
    const allocation = allocationById.get(manifestAllocation.allocationId);
    const planAllocation = planAllocationById.get(manifestAllocation.allocationId);
    for (const tensor of manifestAllocation.tensors) {
      tensors[tensor.name] = Object.freeze({
        schema: WEBGPU_MODEL_RESOURCE_TENSOR_SCHEMA,
        name: tensor.name,
        dtype: tensor.dtype,
        shape: tensor.shape,
        strides: tensor.strides,
        elements: tensor.elements,
        bytesPerElement: tensor.bytesPerElement,
        byteLength: tensor.byteLength,
        allocationByteLength: manifestAllocation.byteLength,
        ownsBuffer: false,
        paddingReserved: true,
        usage: manifestAllocation.usage,
        allocationId: manifestAllocation.allocationId,
        resourceId: planAllocation.resourceId,
        physicalResourceId: planAllocation.physicalResourceId,
        semanticResourceId: planAllocation.semanticResourceId,
        semanticLeaseId: allocation.semanticLeaseId,
        resourceSharingPolicy: plan.manifest.resourceSharing.policy,
        buffer: allocation.buffer,
        bufferOffset: tensor.byteOffset,
        metadata: tensor.metadata,
      });
    }
  }
  const report = deepFreeze({
    schema: WEBGPU_MODEL_RESOURCE_CHUNK_LOAD_REPORT_SCHEMA,
    status: 'loaded',
    planIdentity: plan.identity,
    manifestIdentity: plan.manifest.identity,
    routeId: input.route.routeId,
    startedAtMs,
    settledAtMs: now(),
    failedAllocationId: null,
    failedChunkId: null,
    failedChunkReport: null,
    failedAllocation: null,
    failure: null,
    allocations: loadedAllocations.map(item => item.report),
    progress,
    sourceMemoryBound: sourceMemoryBound(plan),
    cleanup: null,
  });

  let released = false;
  return Object.freeze({
    schema: WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA,
    identity: plan.identity,
    modelId: plan.manifest.modelId,
    revision: plan.manifest.revision,
    resourceSharing: plan.manifest.resourceSharing,
    routeId: input.route.routeId,
    manifest: plan.manifest,
    chunkPlan: plan,
    verification: deepFreeze({
      schema: WEBGPU_MODEL_RESOURCE_CHUNK_PLAN_VERIFICATION_SCHEMA,
      status: 'verified',
      authority: 'complete-allocation-byte-coverage-by-declared-chunk-sha256',
      planIdentity: plan.identity,
      verifiedChunkCount: plan.chunkIds.length,
    }),
    allocations: Object.freeze(allocations),
    tensors: Object.freeze(tensors),
    chunkReport: report,
    release() {
      if (released) {
        return deepFreeze({
          schema: WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA,
          identity: plan.identity,
          routeId: input.route.routeId,
          status: 'already-released',
          releasedLeaseCount: 0,
        });
      }
      released = true;
      const cleanup = releaseLeases(leases);
      return deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA,
        identity: plan.identity,
        routeId: input.route.routeId,
        status: cleanup.failedReleaseCount > 0
          ? 'release-failed'
          : (cleanup.invalidatedLeaseCount > 0 ? 'invalidated' : 'released'),
        ...cleanup,
      });
    },
  });
}
