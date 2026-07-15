import { WEBGPU_BUFFER_USAGE } from './runtime-primitives.js';

export const WEBGPU_MODEL_RESOURCE_MANIFEST_SCHEMA = 'kaminos.webgpu-model-resource-manifest.v1';
export const WEBGPU_MODEL_RESOURCE_BUNDLE_VERIFICATION_SCHEMA = 'kaminos.webgpu-model-resource-bundle-verification.v0';
export const WEBGPU_MODEL_RESOURCE_BUNDLE_CUSTODY_SCHEMA = 'kaminos.webgpu-model-resource-bundle-custody.v0';
export const WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA = 'kaminos.webgpu-model-resource-lease.v0';
export const WEBGPU_MODEL_RESOURCE_TENSOR_SCHEMA = 'kaminos.webgpu-model-resource-tensor.v0';
export const WEBGPU_MODEL_RESOURCE_SHARING_POLICIES = Object.freeze({
  semanticIdentity: 'semantic-identity',
  contentAddressedPhysicalDedupe: 'content-addressed-physical-dedupe',
});

const bundleCustody = new WeakMap();
const PRIOR_PHYSICAL_ONLY_MANIFEST_SCHEMA = 'kaminos.webgpu-model-resource-manifest.v0';

const DTYPE_BYTES = new Map([
  ['f32', 4],
  ['fp32', 4],
  ['float32', 4],
  ['f16', 2],
  ['fp16', 2],
  ['float16', 2],
  ['u32', 4],
  ['i32', 4],
  ['u8', 1],
]);

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
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite numbers; invalid value at ${path}`);
    if (Object.is(value, -0)) throw new Error(`${label} must not contain negative zero; invalid value at ${path}`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} contains unsupported ${typeof value} value at ${path}`);
  }
  if (ancestors.has(value)) throw new Error(`${label} must not contain a cycle at ${path}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value).filter(key => key !== 'length');
      const clone = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor) throw new Error(`${label} must not contain a sparse array hole at ${path}[${index}]`);
        if (!Object.hasOwn(descriptor, 'value')) {
          throw new Error(`${label} arrays must contain only data elements; invalid element at ${path}[${index}]`);
        }
        clone[index] = cloneJson(descriptor.value, label, `${path}[${index}]`, ancestors);
      }
      if (keys.some(key => typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key))) {
        throw new Error(`${label} arrays must not contain symbol or named properties at ${path}`);
      }
      return clone;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must contain only plain JSON objects; invalid object at ${path}`);
    }
    const clone = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') throw new Error(`${label} must not contain symbol keys at ${path}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`${label} must contain only enumerable data properties; invalid property at ${path}.${key}`);
      }
      Object.defineProperty(clone, key, {
        value: cloneJson(descriptor.value, label, `${path}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
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

function validateJsonValue(value, label, errors) {
  try {
    cloneJson(value, label);
    return true;
  } catch (error) {
    errors.push(String(error?.message || error));
    return false;
  }
}

function normalizeDtype(dtype) {
  if (!isNonEmptyString(dtype)) return dtype;
  const normalized = dtype.toLowerCase();
  if (normalized === 'fp32' || normalized === 'float32') return 'f32';
  if (normalized === 'fp16' || normalized === 'float16') return 'f16';
  return normalized;
}

function tensorElements(shape) {
  if (!Array.isArray(shape) || shape.length === 0) return null;
  let elements = 1;
  for (const dimension of shape) {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) return null;
    elements *= dimension;
    if (!Number.isSafeInteger(elements)) return null;
  }
  return elements;
}

function tensorStrides(shape) {
  const strides = new Array(shape.length);
  let stride = 1;
  for (let index = shape.length - 1; index >= 0; index -= 1) {
    strides[index] = stride;
    stride *= shape[index];
  }
  return strides;
}

function bundleIdentity(modelId, revision, sha256) {
  return `${modelId}@${revision}#sha256:${sha256}`;
}

function physicalResourceId(sha256, allocation) {
  return `kaminos:model-resource:sha256:${sha256}:${allocation.byteOffset}:${allocation.byteLength}:${allocation.usage}`;
}

function semanticResourceId(modelId, revision, manifestMetadata, physicalId, allocation) {
  const semantics = canonicalJson({
    modelId,
    revision,
    manifestMetadata,
    allocationId: allocation.allocationId,
    allocationMetadata: allocation.metadata,
    tensors: allocation.tensors,
  });
  return `${physicalId}:semantic:${encodeURIComponent(semantics)}`;
}

function normalizeResourceSharing(input) {
  if (input != null && (typeof input !== 'object' || Array.isArray(input))) {
    throw new Error('resourceSharing must be an object');
  }
  const policy = input?.policy ?? WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.semanticIdentity;
  if (!Object.values(WEBGPU_MODEL_RESOURCE_SHARING_POLICIES).includes(policy)) {
    throw new Error(
      `resourceSharing.policy must be ${WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.semanticIdentity} or ${WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.contentAddressedPhysicalDedupe}`,
    );
  }
  return { policy };
}

function byteView(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    if (typeof SharedArrayBuffer !== 'undefined' && data.buffer instanceof SharedArrayBuffer) {
      throw new Error('model bundle must not use SharedArrayBuffer because mutable shared bytes cannot carry stable bundle identity');
    }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error('model bundle must be an ArrayBuffer or typed array view');
}

function abortError(reason) {
  const message = reason == null ? 'model resource load aborted' : `model resource load aborted: ${String(reason)}`;
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function rangesOverlap(left, right) {
  return left.byteOffset < right.byteOffset + right.byteLength
    && right.byteOffset < left.byteOffset + left.byteLength;
}

export function validateWebGpuModelResourceManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest must be an object'] };
  }
  if (manifest.schema === PRIOR_PHYSICAL_ONLY_MANIFEST_SCHEMA) {
    return {
      ok: false,
      errors: [
        `schema ${PRIOR_PHYSICAL_ONLY_MANIFEST_SCHEMA} is an unsupported prior physical-only manifest; regenerate it as ${WEBGPU_MODEL_RESOURCE_MANIFEST_SCHEMA} and choose resourceSharing policy explicitly`,
      ],
    };
  }
  if (manifest.schema !== WEBGPU_MODEL_RESOURCE_MANIFEST_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_MODEL_RESOURCE_MANIFEST_SCHEMA}`);
  }
  if (!isNonEmptyString(manifest.modelId)) errors.push('modelId must be a non-empty string');
  if (!isNonEmptyString(manifest.revision)) errors.push('revision must be a non-empty string');
  const manifestMetadataValid = validateJsonValue(manifest.metadata, 'manifest metadata', errors);
  const resourceSharingPolicy = manifest.resourceSharing?.policy;
  if (!Object.values(WEBGPU_MODEL_RESOURCE_SHARING_POLICIES).includes(resourceSharingPolicy)) {
    errors.push(
      `resourceSharing.policy must be ${WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.semanticIdentity} or ${WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.contentAddressedPhysicalDedupe}`,
    );
  }
  if (!manifest.bundle || typeof manifest.bundle !== 'object' || Array.isArray(manifest.bundle)) {
    errors.push('bundle must be an object');
  }

  const bundleByteLength = manifest.bundle?.byteLength;
  const bundleSha256 = manifest.bundle?.sha256;
  if (!Number.isSafeInteger(bundleByteLength) || bundleByteLength <= 0) {
    errors.push('bundle.byteLength must be a positive safe integer');
  }
  if (typeof bundleSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(bundleSha256)) {
    errors.push('bundle.sha256 must be a lowercase 64-character SHA-256 hex digest');
  }
  if (
    isNonEmptyString(manifest.modelId)
    && isNonEmptyString(manifest.revision)
    && typeof bundleSha256 === 'string'
    && manifest.identity !== bundleIdentity(manifest.modelId, manifest.revision, bundleSha256)
  ) {
    errors.push('identity must match modelId, revision, and bundle SHA-256');
  }

  if (!Array.isArray(manifest.allocations) || manifest.allocations.length === 0) {
    errors.push('allocations must be a non-empty array');
    return { ok: errors.length === 0, errors };
  }

  const allocationIds = new Set();
  const tensorNames = new Set();
  const validAllocationRanges = [];
  manifest.allocations.forEach((allocation, allocationIndex) => {
    const prefix = `allocations[${allocationIndex}]`;
    if (!allocation || typeof allocation !== 'object' || Array.isArray(allocation)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (!isNonEmptyString(allocation.allocationId)) {
      errors.push(`${prefix}.allocationId must be a non-empty string`);
    } else if (allocationIds.has(allocation.allocationId)) {
      errors.push(`duplicate allocationId ${allocation.allocationId}`);
    } else {
      allocationIds.add(allocation.allocationId);
    }
    const allocationMetadataValid = validateJsonValue(allocation.metadata, `${prefix}.metadata`, errors);
    let tensorMetadataValid = true;
    if (Array.isArray(allocation.tensors)) {
      allocation.tensors.forEach((tensor, tensorIndex) => {
        if (tensor && typeof tensor === 'object' && !Array.isArray(tensor)) {
          tensorMetadataValid = validateJsonValue(
            tensor.metadata,
            `${prefix}.tensors[${tensorIndex}].metadata`,
            errors,
          ) && tensorMetadataValid;
        }
      });
    }
    if (!Number.isSafeInteger(allocation.byteOffset) || allocation.byteOffset < 0) {
      errors.push(`${prefix}.byteOffset must be a non-negative safe integer`);
    }
    if (!Number.isSafeInteger(allocation.byteLength) || allocation.byteLength <= 0) {
      errors.push(`${prefix}.byteLength must be a positive safe integer`);
    } else if (allocation.byteLength % 4 !== 0) {
      errors.push(`${prefix}.byteLength must be a multiple of 4 for queue.writeBuffer`);
    }
    if (!Number.isSafeInteger(allocation.usage) || allocation.usage <= 0) {
      errors.push(`${prefix}.usage must be a positive safe integer`);
    } else if ((allocation.usage & WEBGPU_BUFFER_USAGE.copyDst) === 0) {
      errors.push(`${prefix}.usage must include WEBGPU_BUFFER_USAGE.copyDst`);
    }
    const allocationRangeValid = Number.isSafeInteger(allocation.byteOffset)
      && allocation.byteOffset >= 0
      && Number.isSafeInteger(allocation.byteLength)
      && allocation.byteLength > 0;
    if (allocationRangeValid) {
      validAllocationRanges.push({
        allocationId: allocation.allocationId,
        byteOffset: allocation.byteOffset,
        byteLength: allocation.byteLength,
      });
      if (
        Number.isSafeInteger(bundleByteLength)
        && allocation.byteOffset + allocation.byteLength > bundleByteLength
      ) {
        errors.push(`${prefix} range exceeds bundle byteLength and is outside bundle bytes`);
      }
    }
    if (
      typeof bundleSha256 === 'string'
      && allocationRangeValid
      && Number.isSafeInteger(allocation.usage)
    ) {
      const expectedPhysicalResourceId = physicalResourceId(bundleSha256, allocation);
      if (allocation.physicalResourceId !== expectedPhysicalResourceId) {
        errors.push(`${prefix}.physicalResourceId must be content-derived from bundle and allocation bytes`);
      }
      if (manifestMetadataValid && allocationMetadataValid && tensorMetadataValid) {
        const expectedSemanticResourceId = semanticResourceId(
          manifest.modelId,
          manifest.revision,
          manifest.metadata,
          expectedPhysicalResourceId,
          allocation,
        );
        if (allocation.semanticResourceId !== expectedSemanticResourceId) {
          errors.push(`${prefix}.semanticResourceId must bind model, revision, manifest, allocation, and tensor semantics`);
        }
        const expectedResourceId = resourceSharingPolicy === WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.contentAddressedPhysicalDedupe
          ? expectedPhysicalResourceId
          : expectedSemanticResourceId;
        if (allocation.resourceId !== expectedResourceId) {
          errors.push(`${prefix}.resourceId must match the declared resourceSharing policy`);
        }
      }
    }
    if (!Array.isArray(allocation.tensors) || allocation.tensors.length === 0) {
      errors.push(`${prefix}.tensors must be a non-empty array`);
      return;
    }

    const tensorRanges = [];
    allocation.tensors.forEach((tensor, tensorIndex) => {
      const tensorPrefix = `${prefix}.tensors[${tensorIndex}]`;
      if (!tensor || typeof tensor !== 'object' || Array.isArray(tensor)) {
        errors.push(`${tensorPrefix} must be an object`);
        return;
      }
      if (!isNonEmptyString(tensor.name)) {
        errors.push(`${tensorPrefix}.name must be a non-empty string`);
      } else if (tensorNames.has(tensor.name)) {
        errors.push(`duplicate tensor name ${tensor.name}`);
      } else {
        tensorNames.add(tensor.name);
      }
      const dtype = normalizeDtype(tensor.dtype);
      const bytesPerElement = DTYPE_BYTES.get(dtype);
      if (!bytesPerElement || dtype !== tensor.dtype) {
        errors.push(`${tensorPrefix}.dtype must be a normalized supported dtype`);
      }
      const elements = tensorElements(tensor.shape);
      if (elements == null) errors.push(`${tensorPrefix}.shape must contain positive safe integer dimensions`);
      if (!Number.isSafeInteger(tensor.byteOffset) || tensor.byteOffset < 0) {
        errors.push(`${tensorPrefix}.byteOffset must be a non-negative safe integer`);
      } else if (bytesPerElement && tensor.byteOffset % bytesPerElement !== 0) {
        errors.push(`${tensorPrefix}.byteOffset must align to its dtype byte size`);
      }
      if (!Number.isSafeInteger(tensor.byteLength) || tensor.byteLength <= 0) {
        errors.push(`${tensorPrefix}.byteLength must be a positive safe integer`);
      }
      if (elements != null && bytesPerElement && tensor.byteLength !== elements * bytesPerElement) {
        errors.push(`${tensorPrefix}.byteLength must equal shape elements * dtype size`);
      }
      if (elements != null && tensor.elements !== elements) {
        errors.push(`${tensorPrefix}.elements must match shape`);
      }
      if (bytesPerElement && tensor.bytesPerElement !== bytesPerElement) {
        errors.push(`${tensorPrefix}.bytesPerElement must match dtype`);
      }
      const expectedStrides = Array.isArray(tensor.shape) ? tensorStrides(tensor.shape) : null;
      if (expectedStrides && JSON.stringify(tensor.strides) !== JSON.stringify(expectedStrides)) {
        errors.push(`${tensorPrefix}.strides must be contiguous row-major element strides`);
      }
      if (
        Number.isSafeInteger(tensor.byteOffset)
        && tensor.byteOffset >= 0
        && Number.isSafeInteger(tensor.byteLength)
        && tensor.byteLength > 0
      ) {
        tensorRanges.push({ name: tensor.name, byteOffset: tensor.byteOffset, byteLength: tensor.byteLength });
        if (
          Number.isSafeInteger(allocation.byteLength)
          && tensor.byteOffset + tensor.byteLength > allocation.byteLength
        ) {
          errors.push(`${tensorPrefix} range exceeds its allocation`);
        }
      }
    });
    for (let leftIndex = 0; leftIndex < tensorRanges.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < tensorRanges.length; rightIndex += 1) {
        if (rangesOverlap(tensorRanges[leftIndex], tensorRanges[rightIndex])) {
          errors.push(`tensor ranges overlap in allocation ${allocation.allocationId}`);
        }
      }
    }
  });

  for (let leftIndex = 0; leftIndex < validAllocationRanges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < validAllocationRanges.length; rightIndex += 1) {
      if (rangesOverlap(validAllocationRanges[leftIndex], validAllocationRanges[rightIndex])) {
        errors.push('allocation ranges must not overlap');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function defineWebGpuModelResourceManifest(input = {}) {
  const modelId = input.modelId;
  const revision = input.revision;
  const sha256 = typeof input.bundle?.sha256 === 'string' ? input.bundle.sha256.toLowerCase() : input.bundle?.sha256;
  const metadata = cloneJson(input.metadata ?? null, 'manifest metadata');
  const resourceSharing = normalizeResourceSharing(input.resourceSharing);
  const allocations = (input.allocations || []).map(allocation => {
    const normalized = {
      allocationId: allocation.allocationId,
      byteOffset: allocation.byteOffset,
      byteLength: allocation.byteLength,
      usage: allocation.usage,
      metadata: cloneJson(allocation.metadata ?? null, 'allocation metadata'),
      tensors: (allocation.tensors || []).map(tensor => {
      const dtype = normalizeDtype(tensor.dtype);
      const shape = Array.isArray(tensor.shape) ? [...tensor.shape] : tensor.shape;
      const elements = tensorElements(shape);
      return {
        name: tensor.name,
        dtype,
        shape,
        strides: Array.isArray(shape) ? tensorStrides(shape) : null,
        elements,
        bytesPerElement: DTYPE_BYTES.get(dtype) || null,
        byteOffset: tensor.byteOffset,
        byteLength: tensor.byteLength,
        metadata: cloneJson(tensor.metadata ?? null, 'tensor metadata'),
      };
      }),
    };
    const physicalId = physicalResourceId(sha256, normalized);
    const semanticId = semanticResourceId(modelId, revision, metadata, physicalId, normalized);
    return {
      ...normalized,
      resourceId: resourceSharing.policy === WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.contentAddressedPhysicalDedupe
        ? physicalId
        : semanticId,
      physicalResourceId: physicalId,
      semanticResourceId: semanticId,
    };
  });
  const manifest = {
    schema: WEBGPU_MODEL_RESOURCE_MANIFEST_SCHEMA,
    identity: bundleIdentity(modelId, revision, sha256),
    modelId,
    revision,
    bundle: {
      byteLength: input.bundle?.byteLength,
      sha256,
    },
    metadata,
    resourceSharing,
    allocations,
  };
  const validation = validateWebGpuModelResourceManifest(manifest);
  if (!validation.ok) {
    throw new Error(`invalid WebGPU model resource manifest:\n${validation.errors.join('\n')}`);
  }
  return deepFreeze(manifest);
}

async function verifyBundleSnapshot(manifest, bytes, options = {}) {
  const validation = validateWebGpuModelResourceManifest(manifest);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource manifest:\n${validation.errors.join('\n')}`);
  throwIfAborted(options.signal);
  if (bytes.byteLength !== manifest.bundle.byteLength) {
    throw new Error(`model bundle byteLength ${bytes.byteLength} does not match expected ${manifest.bundle.byteLength}`);
  }
  const subtle = options.subtle || globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('Web Crypto subtle.digest is required to verify model bundle identity');
  }
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  throwIfAborted(options.signal);
  const effectiveSha256 = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (effectiveSha256 !== manifest.bundle.sha256) {
    throw new Error(`model bundle SHA-256 ${effectiveSha256} does not match expected ${manifest.bundle.sha256}`);
  }
  return deepFreeze({
    schema: WEBGPU_MODEL_RESOURCE_BUNDLE_VERIFICATION_SCHEMA,
    status: 'verified',
    algorithm: 'SHA-256',
    expectedByteLength: manifest.bundle.byteLength,
    effectiveByteLength: bytes.byteLength,
    expectedSha256: manifest.bundle.sha256,
    effectiveSha256,
    byteCustody: options.byteCustody || 'loader-owned-snapshot-before-verification',
  });
}

export async function verifyWebGpuModelResourceBundle(manifest, bundle, options = {}) {
  throwIfAborted(options.signal);
  const bytes = Uint8Array.from(byteView(bundle));
  return verifyBundleSnapshot(manifest, bytes, {
    ...options,
    byteCustody: 'loader-owned-snapshot-before-verification',
  });
}

async function prepareBundle(manifest, bundle, ownership, options = {}, internal = {}) {
  const validation = validateWebGpuModelResourceManifest(manifest);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource manifest:\n${validation.errors.join('\n')}`);
  if (ownership !== 'copy' && ownership !== 'transfer') {
    throw new Error('model bundle ownership must be copy or transfer');
  }
  throwIfAborted(options.signal);

  let bytes;
  if (ownership === 'transfer') {
    if (!(bundle instanceof ArrayBuffer)) {
      throw new Error('transfer ownership requires a full ArrayBuffer');
    }
    if (bundle.byteLength !== manifest.bundle.byteLength) {
      throw new Error(`model bundle byteLength ${bundle.byteLength} does not match expected ${manifest.bundle.byteLength}`);
    }
    const transfer = globalThis.structuredClone;
    if (typeof transfer !== 'function') {
      throw new Error('structuredClone with ArrayBuffer transfer is required for transfer ownership');
    }
    const ownedBuffer = transfer(bundle, { transfer: [bundle] });
    bytes = new Uint8Array(ownedBuffer);
  } else {
    bytes = Uint8Array.from(byteView(bundle));
  }

  const verification = await verifyBundleSnapshot(manifest, bytes, {
    signal: options.signal,
    subtle: options.subtle,
    byteCustody: internal.byteCustody || `loader-owned-${ownership}-before-verification`,
  });
  const state = {
    identity: manifest.identity,
    manifestFingerprint: canonicalJson(manifest),
    ownership,
    bytes,
    released: false,
  };
  let handle;
  handle = Object.freeze({
    schema: WEBGPU_MODEL_RESOURCE_BUNDLE_CUSTODY_SCHEMA,
    identity: manifest.identity,
    ownership,
    byteLength: bytes.byteLength,
    verification,
    snapshot() {
      return deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_BUNDLE_CUSTODY_SCHEMA,
        identity: manifest.identity,
        ownership,
        byteLength: state.bytes?.byteLength ?? 0,
        status: state.released ? 'released' : 'owned',
        verification,
      });
    },
    release() {
      if (state.released) {
        return deepFreeze({
          schema: WEBGPU_MODEL_RESOURCE_BUNDLE_CUSTODY_SCHEMA,
          identity: manifest.identity,
          ownership,
          status: 'already-released',
          releasedByteLength: 0,
        });
      }
      const releasedByteLength = state.bytes.byteLength;
      state.bytes = null;
      state.released = true;
      return deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_BUNDLE_CUSTODY_SCHEMA,
        identity: manifest.identity,
        ownership,
        status: 'released',
        releasedByteLength,
      });
    },
  });
  bundleCustody.set(handle, state);
  return handle;
}

export function prepareWebGpuModelResourceBundle(manifest, bundle, options = {}) {
  return prepareBundle(manifest, bundle, options.ownership || 'copy', options);
}

function assertRoute(route) {
  if (!route || typeof route !== 'object') throw new Error('route must be a session route handle');
  if (!isNonEmptyString(route.routeId)) throw new Error('route.routeId must be a non-empty string');
  if (!route.runtime || typeof route.runtime.createBuffer !== 'function' || typeof route.runtime.writeBuffer !== 'function') {
    throw new Error('route.runtime must expose createBuffer and writeBuffer');
  }
  if (!route.residency || typeof route.residency.acquireOrCreate !== 'function') {
    throw new Error('route.residency must expose acquireOrCreate');
  }
}

function releaseLeases(leases) {
  const releases = [];
  const failures = [];
  for (const lease of [...leases].reverse()) {
    try {
      releases.push(lease.release());
    } catch (error) {
      failures.push({
        resourceId: lease.resourceId,
        message: String(error?.message || error),
      });
    }
  }
  return deepFreeze({
    releasedLeaseCount: releases.length,
    failedReleaseCount: failures.length,
    releases,
    failures,
  });
}

export async function loadWebGpuModelResources(input = {}) {
  const { manifest, route, signal } = input;
  assertRoute(route);
  throwIfAborted(signal);
  let custody = bundleCustody.get(input.bundle);
  if (!custody) {
    if (input.bundle?.schema === WEBGPU_MODEL_RESOURCE_BUNDLE_CUSTODY_SCHEMA) {
      throw new Error('model bundle custody handle must be authentic and module-issued');
    }
    const prepared = await prepareBundle(
      manifest,
      input.bundle,
      'copy',
      { signal, subtle: input.subtle },
      { byteCustody: 'loader-owned-snapshot-before-verification' },
    );
    try {
      return await loadWebGpuModelResources({ ...input, bundle: prepared });
    } finally {
      prepared.release();
    }
  }
  if (custody.released) throw new Error('model bundle custody handle is released');
  const validation = validateWebGpuModelResourceManifest(manifest);
  if (!validation.ok) throw new Error(`invalid WebGPU model resource manifest:\n${validation.errors.join('\n')}`);
  if (custody.identity !== manifest?.identity) {
    throw new Error(`prepared model bundle manifest identity ${custody.identity} does not match ${manifest?.identity || '<missing>'}`);
  }
  if (custody.manifestFingerprint !== canonicalJson(manifest)) {
    throw new Error('prepared model bundle manifest content does not match the manifest used to establish custody');
  }
  const bytes = custody.bytes;
  const verification = input.bundle.verification;
  const leases = [];
  const allocations = [];
  try {
    for (const allocation of manifest.allocations) {
      throwIfAborted(signal);
      let lease;
      try {
        const sharedPhysical = manifest.resourceSharing.policy
          === WEBGPU_MODEL_RESOURCE_SHARING_POLICIES.contentAddressedPhysicalDedupe;
        lease = await route.residency.acquireOrCreate({
          resourceId: allocation.resourceId,
          declaredBytes: allocation.byteLength,
          kind: 'model-weight-buffer',
          metadata: {
            resourceSharingPolicy: manifest.resourceSharing.policy,
            physicalResourceId: allocation.physicalResourceId,
            bundleSha256: manifest.bundle.sha256,
            bundleByteLength: manifest.bundle.byteLength,
            sourceByteOffset: allocation.byteOffset,
            byteLength: allocation.byteLength,
            usage: allocation.usage,
            ...(sharedPhysical ? {} : {
              semanticResourceId: allocation.semanticResourceId,
              modelId: manifest.modelId,
              revision: manifest.revision,
              manifestMetadata: manifest.metadata,
              allocationId: allocation.allocationId,
              allocationMetadata: allocation.metadata,
              tensorSemantics: allocation.tensors,
            }),
          },
          signal,
          create({ signal: flightSignal }) {
            throwIfAborted(flightSignal);
            let buffer;
            try {
              const createResidentBuffer = typeof route.runtime.createManagedBuffer === 'function'
                ? route.runtime.createManagedBuffer.bind(route.runtime)
                : route.runtime.createBuffer.bind(route.runtime);
              buffer = createResidentBuffer({
                label: `${manifest.modelId}@${manifest.revision}:${allocation.allocationId}`,
                size: allocation.byteLength,
                usage: allocation.usage,
              });
              route.runtime.writeBuffer(
                buffer,
                bytes.subarray(allocation.byteOffset, allocation.byteOffset + allocation.byteLength),
              );
              return buffer;
            } catch (error) {
              if (buffer && typeof buffer.destroy === 'function') buffer.destroy();
              throw error;
            }
          },
          dispose(buffer) {
            if (typeof buffer.destroy === 'function') buffer.destroy();
          },
        });
      } catch (cause) {
        const error = new Error(`failed to load model allocation ${allocation.allocationId}: ${String(cause?.message || cause)}`);
        error.name = cause?.name || 'Error';
        error.cause = cause;
        error.phase = 'allocation';
        error.allocationId = allocation.allocationId;
        throw error;
      }
      leases.push(lease);
      allocations.push(Object.freeze({
        allocationId: allocation.allocationId,
        resourceId: allocation.resourceId,
        physicalResourceId: allocation.physicalResourceId,
        semanticResourceId: allocation.semanticResourceId,
        semanticLeaseId: `${allocation.semanticResourceId}:lease:${lease.leaseId}`,
        resourceSharingPolicy: manifest.resourceSharing.policy,
        leaseId: lease.leaseId,
        generation: lease.generation,
        byteOffset: allocation.byteOffset,
        byteLength: allocation.byteLength,
        usage: allocation.usage,
        buffer: lease.resource,
      }));
    }
  } catch (error) {
    error.cleanup = releaseLeases(leases);
    error.verification = verification;
    throw error;
  }

  const allocationById = new Map(allocations.map(allocation => [allocation.allocationId, allocation]));
  const tensors = Object.create(null);
  for (const manifestAllocation of manifest.allocations) {
    const allocation = allocationById.get(manifestAllocation.allocationId);
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
        resourceId: manifestAllocation.resourceId,
        physicalResourceId: manifestAllocation.physicalResourceId,
        semanticResourceId: manifestAllocation.semanticResourceId,
        semanticLeaseId: allocation.semanticLeaseId,
        resourceSharingPolicy: manifest.resourceSharing.policy,
        buffer: allocation.buffer,
        bufferOffset: tensor.byteOffset,
        metadata: tensor.metadata,
      });
    }
  }

  let released = false;
  return Object.freeze({
    schema: WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA,
    identity: manifest.identity,
    modelId: manifest.modelId,
    revision: manifest.revision,
    resourceSharing: manifest.resourceSharing,
    routeId: route.routeId,
    manifest,
    verification,
    allocations: Object.freeze(allocations),
    tensors: Object.freeze(tensors),
    release() {
      if (released) {
        return deepFreeze({
          schema: WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA,
          identity: manifest.identity,
          routeId: route.routeId,
          status: 'already-released',
          releasedLeaseCount: 0,
        });
      }
      released = true;
      const cleanup = releaseLeases(leases);
      return deepFreeze({
        schema: WEBGPU_MODEL_RESOURCE_LEASE_SCHEMA,
        identity: manifest.identity,
        routeId: route.routeId,
        status: cleanup.failedReleaseCount === 0 ? 'released' : 'release-failed',
        ...cleanup,
      });
    },
  });
}
