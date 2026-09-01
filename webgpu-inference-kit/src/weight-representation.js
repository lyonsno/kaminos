export const WEBGPU_WEIGHT_REPRESENTATION_PLAN_SCHEMA = 'kaminos.webgpu-weight-representation-plan.v0';

const REPRESENTATIONS = Object.freeze({
  'f32-expanded': Object.freeze({
    storageDtype: 'f32',
    bytesPerElement: 4,
    requiredFeatures: Object.freeze([]),
    valueLoadOperation: 'wgsl-f32-load',
  }),
  'f16-native': Object.freeze({
    storageDtype: 'f16',
    bytesPerElement: 2,
    requiredFeatures: Object.freeze(['shader-f16']),
    valueLoadOperation: 'wgsl-f16-load-cast-f32',
  }),
  'f16-packed-u32': Object.freeze({
    storageDtype: 'u32',
    bytesPerElement: 2,
    requiredFeatures: Object.freeze([]),
    valueLoadOperation: 'wgsl-unpack2x16float',
  }),
});

function alignedGpuBufferByteLength(byteLength) {
  return Math.ceil(byteLength / 4) * 4;
}

function featureSet(adapterFeatures) {
  if (adapterFeatures == null) return new Set();
  if (typeof adapterFeatures[Symbol.iterator] !== 'function') {
    throw new TypeError('adapterFeatures must be iterable');
  }
  const features = new Set(adapterFeatures);
  for (const feature of features) {
    if (typeof feature !== 'string' || feature.length === 0) {
      throw new TypeError('adapterFeatures must contain non-empty strings');
    }
  }
  return features;
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('weight representation input must be an object');
  }
  if (input.sourceDtype !== 'fp16') {
    throw new RangeError(`unsupported sourceDtype ${input.sourceDtype}; expected fp16`);
  }
  if (!Number.isSafeInteger(input.elementCount) || input.elementCount <= 0) {
    throw new RangeError('elementCount must be a positive safe integer');
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new TypeError('candidates must be a non-empty ordered array');
  }
  if (new Set(input.candidates).size !== input.candidates.length) {
    throw new RangeError('candidates must not contain duplicates');
  }
  for (const representation of input.candidates) {
    if (!Object.hasOwn(REPRESENTATIONS, representation)) {
      throw new RangeError(`unsupported weight representation ${representation}`);
    }
  }
  if (input.maxStorageByteLength != null
      && (!Number.isSafeInteger(input.maxStorageByteLength) || input.maxStorageByteLength < 0)) {
    throw new RangeError('maxStorageByteLength must be a non-negative safe integer');
  }
}

/**
 * Select one caller-authorized storage representation without silently adding
 * a larger fallback. Every current representation loads the represented value
 * into f32 and accumulates in f32; this contract does not quantize new values.
 */
export function createWebGpuWeightRepresentationPlan(input) {
  validateInput(input);
  const availableFeatures = featureSet(input.adapterFeatures);
  const sourceByteLength = input.elementCount * 2;
  const expandedFp32ByteLength = input.elementCount * 4;
  const rejectedCandidates = [];

  for (const representation of input.candidates) {
    const descriptor = REPRESENTATIONS[representation];
    const missingFeature = descriptor.requiredFeatures.find(feature => !availableFeatures.has(feature));
    if (missingFeature) {
      rejectedCandidates.push(Object.freeze({
        representation,
        reason: `missing-adapter-feature:${missingFeature}`,
      }));
      continue;
    }

    const storageByteLength = alignedGpuBufferByteLength(
      input.elementCount * descriptor.bytesPerElement,
    );
    if (input.maxStorageByteLength != null && storageByteLength > input.maxStorageByteLength) {
      rejectedCandidates.push(Object.freeze({
        representation,
        reason: `storage byte length ${storageByteLength} exceeds maxStorageByteLength ${input.maxStorageByteLength}`,
      }));
      continue;
    }

    return Object.freeze({
      schema: WEBGPU_WEIGHT_REPRESENTATION_PLAN_SCHEMA,
      sourceDtype: input.sourceDtype,
      elementCount: input.elementCount,
      requestedCandidates: Object.freeze([...input.candidates]),
      effectiveRepresentation: representation,
      storageDtype: descriptor.storageDtype,
      accumulatorDtype: 'fp32',
      sourceByteLength,
      storageByteLength,
      expandedFp32ByteLength,
      savedVsExpandedFp32ByteLength: expandedFp32ByteLength - storageByteLength,
      requiredFeatures: descriptor.requiredFeatures,
      valueLoadOperation: descriptor.valueLoadOperation,
      rejectedCandidates: Object.freeze(rejectedCandidates),
    });
  }

  const reasons = rejectedCandidates.map(candidate => (
    `${candidate.representation} (${candidate.reason})`
  )).join(', ');
  throw new Error(`no requested weight representation is supported: ${reasons}`);
}

/** Pack two IEEE-754 binary16 bit patterns into each little-endian u32 word. */
export function packFp16WeightsToU32(values) {
  if (!(values instanceof Uint16Array)) {
    throw new TypeError('values must be a Uint16Array containing fp16 bit patterns');
  }
  const words = new Uint32Array(Math.ceil(values.length / 2));
  for (let index = 0; index < values.length; index += 2) {
    const low = values[index];
    const high = index + 1 < values.length ? values[index + 1] : 0;
    words[index / 2] = low | (high << 16);
  }
  return words;
}
