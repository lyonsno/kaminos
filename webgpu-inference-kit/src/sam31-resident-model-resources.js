import {
  WEBGPU_BUFFER_USAGE,
} from './runtime-primitives.js';
import {
  defineWebGpuModelResourceManifest,
  prepareWebGpuModelResourceBundle,
} from './model-resource-manifest.js';

export const SAM31_RESIDENT_MODEL_RESOURCES_SCHEMA = 'kaminos.sam31-resident-model-resources.v0';

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function normalizeDtype(dtype, sourceData) {
  const value = String(dtype || '').toLowerCase();
  if (value === 'float32' || value === 'fp32') return 'f32';
  if (value === 'float16' || value === 'fp16') return 'f16';
  if (value) return value;
  if (sourceData instanceof Float32Array) return 'f32';
  if (sourceData instanceof Uint32Array) return 'u32';
  if (sourceData instanceof Int32Array) return 'i32';
  if (sourceData instanceof Uint8Array) return 'u8';
  throw new Error('resident tensor dtype is required');
}

function sourceByteLength(sourceData) {
  if (sourceData instanceof ArrayBuffer) return sourceData.byteLength;
  if (ArrayBuffer.isView(sourceData)) return sourceData.byteLength;
  throw new Error('resident tensor source must be an ArrayBuffer or typed array');
}

function sourceShape(entry, sourceData) {
  if (Array.isArray(entry.shape) && entry.shape.length > 0) return [...entry.shape];
  if (ArrayBuffer.isView(sourceData) && Number.isSafeInteger(sourceData.length)) return [sourceData.length];
  return [sourceByteLength(sourceData)];
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function artifactHex(sha256) {
  const value = requireString(sha256, 'static artifact sha256');
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`invalid static artifact sha256 ${value}`);
  return value.slice(7);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export async function createSam31ResidentModelResources({ packageRuntime, route } = {}) {
  requireObject(packageRuntime, 'packageRuntime');
  requireObject(route, 'route');
  if (typeof packageRuntime.loadUint8 !== 'function') throw new Error('packageRuntime.loadUint8 must be a function');
  if (typeof route.loadModelResources !== 'function') throw new Error('route.loadModelResources must be a function');
  const packageId = requireString(packageRuntime.packageId, 'packageRuntime.packageId');
  const modelPackage = requireObject(packageRuntime.modelPackage, 'packageRuntime.modelPackage');
  const artifacts = modelPackage.staticArtifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error('model package staticArtifacts must be a non-empty array');

  const seenSha = new Set();
  const loaded = [];
  let bundleByteLength = 0;
  for (const [index, artifact] of artifacts.entries()) {
    requireObject(artifact, `staticArtifacts[${index}]`);
    artifactHex(artifact.sha256);
    if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength <= 0 || artifact.byteLength % 4 !== 0) {
      throw new Error(`static artifact ${artifact.sha256} byteLength must be a positive multiple of 4`);
    }
    if (seenSha.has(artifact.sha256)) throw new Error(`duplicate static artifact ${artifact.sha256}`);
    seenSha.add(artifact.sha256);
    loaded.push({ artifact, byteOffset: bundleByteLength });
    bundleByteLength += artifact.byteLength;
  }

  const bundle = new Uint8Array(bundleByteLength);
  for (const item of loaded) {
    const { artifact } = item;
    const bytes = await packageRuntime.loadUint8(artifact);
    if (!(bytes instanceof Uint8Array)) throw new Error(`static artifact ${artifact.sha256} did not load as Uint8Array`);
    if (bytes.byteLength !== artifact.byteLength) throw new Error(`static artifact ${artifact.sha256} byte length mismatch`);
    const effectiveSha256 = `sha256:${await sha256Hex(bytes)}`;
    if (effectiveSha256 !== artifact.sha256) throw new Error(`static artifact ${artifact.sha256} content hash mismatch: ${effectiveSha256}`);
    item.authenticatedSource = {
      buffer: bytes.buffer,
      byteOffset: bytes.byteOffset,
      byteLength: bytes.byteLength,
    };
    bundle.set(bytes, item.byteOffset);
  }

  const bundleSha256 = await sha256Hex(bundle);
  const usage = WEBGPU_BUFFER_USAGE.storage | WEBGPU_BUFFER_USAGE.copyDst;
  const model = modelPackage.model || {};
  const manifest = defineWebGpuModelResourceManifest({
    modelId: model.id || 'facebook/sam3.1',
    revision: model.revision || packageId,
    metadata: { packageId, kernelProfile: 'sam31-resident-model-owner-v0' },
    bundle: { byteLength: bundle.byteLength, sha256: bundleSha256 },
    allocations: loaded.map((item, index) => ({
      allocationId: `sam31-static-${index}-${artifactHex(item.artifact.sha256).slice(0, 16)}`,
      byteOffset: item.byteOffset,
      byteLength: item.artifact.byteLength,
      usage,
      metadata: {
        packageId,
        modelId: model.id || 'facebook/sam3.1',
        revision: model.revision || packageId,
        kernelProfile: 'sam31-resident-model-owner-v0',
        file: item.artifact.file,
        artifactSha256: item.artifact.sha256,
        aliases: cloneJson(item.artifact.aliases || []),
      },
      tensors: [{
        name: `sam31.static.${artifactHex(item.artifact.sha256)}`,
        dtype: 'u8',
        shape: [item.artifact.byteLength],
        byteOffset: 0,
        byteLength: item.artifact.byteLength,
        metadata: { artifactSha256: item.artifact.sha256 },
      }],
    })),
  });
  const preparedBundle = await prepareWebGpuModelResourceBundle(manifest, bundle.buffer, { ownership: 'transfer' });
  let modelLease;
  try {
    modelLease = await route.loadModelResources({ manifest, bundle: preparedBundle });
  } finally {
    preparedBundle.release();
  }
  const allocationBySha = new Map();
  const authenticatedByBuffer = new Map();
  for (let index = 0; index < loaded.length; index += 1) {
    const resident = {
      artifact: loaded[index].artifact,
      authenticatedSource: loaded[index].authenticatedSource,
      allocation: modelLease.allocations[index],
    };
    allocationBySha.set(loaded[index].artifact.sha256, resident);
    const candidates = authenticatedByBuffer.get(resident.authenticatedSource.buffer) || [];
    candidates.push(resident);
    authenticatedByBuffer.set(resident.authenticatedSource.buffer, candidates);
  }

  const sourceBindings = new WeakMap();
  const bindingEvidence = [];
  const bufferIds = new WeakMap();
  let nextBufferId = 1;
  let released = false;
  function bufferId(buffer) {
    if (!bufferIds.has(buffer)) bufferIds.set(buffer, `sam31-resident-buffer:${nextBufferId++}`);
    return bufferIds.get(buffer);
  }

  function authenticatedView(entry, Type) {
    if (released) throw new Error('SAM 3.1 resident model resources are released');
    requireObject(entry, 'resident tensor entry');
    const resident = allocationBySha.get(entry.sha256);
    if (!resident) throw new Error(`unknown static artifact is not resident: ${entry.sha256 || '<missing>'}`);
    if (entry.byteLength !== resident.artifact.byteLength) {
      throw new Error(`resident tensor byte length mismatch for ${entry.role || entry.file || entry.sha256}`);
    }
    const { buffer, byteOffset, byteLength } = resident.authenticatedSource;
    if (byteOffset % Type.BYTES_PER_ELEMENT !== 0 || byteLength % Type.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`resident tensor source alignment mismatch for ${entry.role || entry.file || entry.sha256}`);
    }
    return new Type(buffer, byteOffset, byteLength / Type.BYTES_PER_ELEMENT);
  }

  const api = {
    schema: SAM31_RESIDENT_MODEL_RESOURCES_SCHEMA,
    packageId,
    manifest,
    modelLease,
    loadUint8(entry) {
      return authenticatedView(entry, Uint8Array);
    },
    loadFloat32(entry) {
      return authenticatedView(entry, Float32Array);
    },
    bind(entry, sourceData) {
      if (released) throw new Error('SAM 3.1 resident model resources are released');
      requireObject(entry, 'resident tensor entry');
      const resident = allocationBySha.get(entry.sha256);
      if (!resident) throw new Error(`unknown static artifact is not resident: ${entry.sha256 || '<missing>'}`);
      const byteLength = sourceByteLength(sourceData);
      if (byteLength !== resident.artifact.byteLength || byteLength !== entry.byteLength) {
        throw new Error(`resident tensor byte length mismatch for ${entry.role || entry.file || entry.sha256}`);
      }
      const sourceBuffer = sourceData instanceof ArrayBuffer ? sourceData : sourceData.buffer;
      const sourceByteOffset = sourceData instanceof ArrayBuffer ? 0 : sourceData.byteOffset;
      if (
        sourceBuffer !== resident.authenticatedSource.buffer
        || sourceByteOffset !== resident.authenticatedSource.byteOffset
        || byteLength !== resident.authenticatedSource.byteLength
      ) {
        throw new Error(`resident tensor source custody does not match the authenticated backing store for ${entry.role || entry.file || entry.sha256}`);
      }
      const existing = sourceBindings.get(sourceData);
      if (existing) {
        if (existing.resourceId !== resident.allocation.resourceId) throw new Error('resident tensor source identity is already bound to another resource');
        return existing;
      }
      const binding = Object.freeze({
        buffer: resident.allocation.buffer,
        bufferOffset: 0,
        dtype: normalizeDtype(entry.dtype, sourceData),
        shape: sourceShape(entry, sourceData),
        byteLength,
        usage: resident.allocation.usage,
        paddingReserved: true,
        sourceData,
        resourceId: resident.allocation.resourceId,
        allocationId: resident.allocation.allocationId,
        artifactSha256: entry.sha256,
      });
      sourceBindings.set(sourceData, binding);
      bindingEvidence.push({
        sequence: bindingEvidence.length + 1,
        role: entry.role || null,
        artifactSha256: entry.sha256,
        byteLength,
        dtype: binding.dtype,
        shape: [...binding.shape],
        resourceId: binding.resourceId,
        allocationId: binding.allocationId,
        liveBufferId: bufferId(binding.buffer),
      });
      return binding;
    },
    residentTensorResolver(tensorInput = {}) {
      if (released) throw new Error('SAM 3.1 resident model resources are released');
      if (!tensorInput.sourceData || (typeof tensorInput.sourceData !== 'object' && typeof tensorInput.sourceData !== 'function')) return null;
      const existing = sourceBindings.get(tensorInput.sourceData);
      if (existing) return existing;
      if (!ArrayBuffer.isView(tensorInput.sourceData)) return null;
      const candidates = (authenticatedByBuffer.get(tensorInput.sourceData.buffer) || []).filter(candidate => {
        const sourceStart = tensorInput.sourceData.byteOffset;
        const sourceEnd = sourceStart + tensorInput.sourceData.byteLength;
        const authenticatedStart = candidate.authenticatedSource.byteOffset;
        const authenticatedEnd = authenticatedStart + candidate.authenticatedSource.byteLength;
        return sourceStart >= authenticatedStart && sourceEnd <= authenticatedEnd;
      });
      if (candidates.length === 0) return null;
      if (candidates.length > 1) throw new Error(`resident tensor source range is ambiguous for ${tensorInput.name || '<unnamed>'}`);
      const resident = candidates[0];
      const bufferOffset = tensorInput.sourceData.byteOffset - resident.authenticatedSource.byteOffset;
      const binding = Object.freeze({
        buffer: resident.allocation.buffer,
        bufferOffset,
        dtype: normalizeDtype(tensorInput.dtype, tensorInput.sourceData),
        shape: Array.isArray(tensorInput.shape) ? [...tensorInput.shape] : sourceShape({}, tensorInput.sourceData),
        byteLength: tensorInput.sourceData.byteLength,
        usage: resident.allocation.usage,
        paddingReserved: true,
        sourceData: tensorInput.sourceData,
        resourceId: resident.allocation.resourceId,
        allocationId: resident.allocation.allocationId,
        artifactSha256: resident.artifact.sha256,
      });
      sourceBindings.set(tensorInput.sourceData, binding);
      bindingEvidence.push({
        sequence: bindingEvidence.length + 1,
        role: tensorInput.name || null,
        artifactSha256: resident.artifact.sha256,
        byteLength: binding.byteLength,
        bufferOffset,
        dtype: binding.dtype,
        shape: [...binding.shape],
        resourceId: binding.resourceId,
        allocationId: binding.allocationId,
        liveBufferId: bufferId(binding.buffer),
      });
      return binding;
    },
    evidence() {
      return Object.freeze({
        schema: 'kaminos.sam31-resident-model-resources-evidence.v0',
        packageId,
        manifestIdentity: manifest.identity,
        bundleVerification: cloneJson(modelLease.verification),
        released,
        truncated: false,
        resourceCount: loaded.length,
        allocationCount: loaded.length,
        uploadCount: loaded.length,
        bindingCount: bindingEvidence.length,
        resources: loaded.map((item, index) => {
          const allocation = modelLease.allocations[index];
          return {
            artifactSha256: item.artifact.sha256,
            file: item.artifact.file,
            aliases: cloneJson(item.artifact.aliases || []),
            byteLength: item.artifact.byteLength,
            resourceId: allocation.resourceId,
            allocationId: allocation.allocationId,
            generation: allocation.generation,
            liveBufferId: bufferId(allocation.buffer),
          };
        }),
        bindings: bindingEvidence.map(cloneJson),
      });
    },
    release() {
      if (released) return Object.freeze({ schema: SAM31_RESIDENT_MODEL_RESOURCES_SCHEMA, packageId, status: 'already-released' });
      released = true;
      return modelLease.release();
    },
  };
  return Object.freeze(api);
}
