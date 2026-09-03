export const WEBGPU_PARITY_COMPARISON_SCHEMA = 'kaminos.webgpu-parity-comparison.v0';
export const WEBGPU_PARITY_CAPTURE_SCHEMA = 'kaminos.webgpu-parity-capture.v0';
export const WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA = 'kaminos.webgpu-parity-capture-chunk.v0';

const TYPED_ARRAYS = new Map([
  ['Int8Array', Int8Array],
  ['Uint8Array', Uint8Array],
  ['Uint8ClampedArray', Uint8ClampedArray],
  ['Int16Array', Int16Array],
  ['Uint16Array', Uint16Array],
  ['Int32Array', Int32Array],
  ['Uint32Array', Uint32Array],
  ['Float32Array', Float32Array],
  ['Float64Array', Float64Array],
]);

const PLATFORM_BYTE_ORDER = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 0x02
  ? 'little-endian'
  : 'big-endian';

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function requireIdentity(name, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireNumericTypedArray(name, value) {
  const constructorName = value?.constructor?.name;
  if (!ArrayBuffer.isView(value) || value instanceof DataView || !TYPED_ARRAYS.has(constructorName)) {
    throw new TypeError(`${name} must be a numeric typed array`);
  }
  return constructorName;
}

function normalizeShape(shape, elementCount) {
  if (shape == null) return null;
  if (!Array.isArray(shape) || shape.length === 0) {
    throw new TypeError('shape must be a non-empty array when provided');
  }
  let product = 1;
  const normalized = shape.map((dimension, index) => {
    if (!Number.isSafeInteger(dimension) || dimension < 0) {
      throw new TypeError(`shape[${index}] must be a nonnegative safe integer`);
    }
    product *= dimension;
    if (!Number.isSafeInteger(product)) throw new RangeError('shape element count exceeds safe integer capacity');
    return dimension;
  });
  if (product !== elementCount) {
    throw new RangeError(`shape describes ${product} elements, expected ${elementCount}`);
  }
  return Object.freeze(normalized);
}

function normalizeSampling(sampling, sourceElementCount) {
  if (sampling == null || sampling.mode === 'all') {
    return Object.freeze({
      mode: 'all',
      stride: 1,
      offset: 0,
      firstSourceIndex: sourceElementCount === 0 ? null : 0,
      lastSourceIndex: sourceElementCount === 0 ? null : sourceElementCount - 1,
    });
  }
  if (!isPlainObject(sampling) || sampling.mode !== 'stride') {
    throw new TypeError('sampling must use mode all or stride');
  }
  const { stride, offset = 0 } = sampling;
  if (!Number.isSafeInteger(stride) || stride <= 0) {
    throw new TypeError('sampling.stride must be a positive safe integer');
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= stride) {
    throw new TypeError('sampling.offset must be a nonnegative safe integer below stride');
  }
  const firstSourceIndex = offset < sourceElementCount ? offset : null;
  const lastSourceIndex = firstSourceIndex == null
    ? null
    : offset + Math.floor((sourceElementCount - 1 - offset) / stride) * stride;
  return Object.freeze({
    mode: 'stride',
    stride,
    offset,
    firstSourceIndex,
    lastSourceIndex,
  });
}

function describeNonFinite(values, indices) {
  const result = { count: 0, nanCount: 0, positiveInfinityCount: 0, negativeInfinityCount: 0 };
  for (const index of indices) {
    const value = values[index];
    if (Number.isFinite(value)) continue;
    result.count += 1;
    if (Number.isNaN(value)) result.nanCount += 1;
    else if (value === Number.POSITIVE_INFINITY) result.positiveInfinityCount += 1;
    else result.negativeInfinityCount += 1;
  }
  return Object.freeze(result);
}

function summarize(values, indices) {
  let sum = 0;
  let sumSquares = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const index of indices) {
    const value = values[index];
    sum += value;
    sumSquares += value * value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const mean = sum / indices.length;
  const standardDeviation = Math.sqrt(Math.max(0, sumSquares / indices.length - mean * mean));
  return Object.freeze({ min, max, mean, standardDeviation });
}

export function compareWebGpuParityArrays(actual, reference, options = {}) {
  const actualType = requireNumericTypedArray('actual', actual);
  const referenceType = requireNumericTypedArray('reference', reference);
  if (!isPlainObject(options)) throw new TypeError('options must be an object');
  if (actual.length !== reference.length) {
    throw new RangeError('actual and reference must have the same length');
  }
  if (actual.length === 0) throw new RangeError('actual and reference must not be empty');

  const sampling = normalizeSampling(options.sampling, actual.length);
  const indices = [];
  for (let index = sampling.offset; index < actual.length; index += sampling.stride) indices.push(index);
  if (indices.length === 0) throw new RangeError('sampling selects no elements');

  const actualNonFinite = describeNonFinite(actual, indices);
  const referenceNonFinite = describeNonFinite(reference, indices);
  if (actualNonFinite.count > 0 || referenceNonFinite.count > 0) {
    throw new RangeError(
      `comparison contains non-finite values: actual=${actualNonFinite.count}, reference=${referenceNonFinite.count}`,
    );
  }

  let sumAbsoluteError = 0;
  let sumSquaredError = 0;
  let actualSquaredNorm = 0;
  let referenceSquaredNorm = 0;
  let dotProduct = 0;
  let maxAbsoluteError = -1;
  let worstSourceIndex = null;
  for (const index of indices) {
    const actualValue = actual[index];
    const referenceValue = reference[index];
    const absoluteError = Math.abs(actualValue - referenceValue);
    sumAbsoluteError += absoluteError;
    sumSquaredError += absoluteError * absoluteError;
    actualSquaredNorm += actualValue * actualValue;
    referenceSquaredNorm += referenceValue * referenceValue;
    dotProduct += actualValue * referenceValue;
    if (absoluteError > maxAbsoluteError) {
      maxAbsoluteError = absoluteError;
      worstSourceIndex = index;
    }
  }

  const l2Error = Math.sqrt(sumSquaredError);
  const relativeL2Error = referenceSquaredNorm === 0
    ? (sumSquaredError === 0 ? 0 : Number.POSITIVE_INFINITY)
    : Math.sqrt(sumSquaredError / referenceSquaredNorm);
  const cosineDenominator = Math.sqrt(actualSquaredNorm * referenceSquaredNorm);
  const metrics = {
    maxAbsoluteError,
    worstSourceIndex,
    worstActual: actual[worstSourceIndex],
    worstReference: reference[worstSourceIndex],
    meanAbsoluteError: sumAbsoluteError / indices.length,
    rootMeanSquareError: Math.sqrt(sumSquaredError / indices.length),
    l2Error,
    relativeL2Error,
    cosineSimilarity: cosineDenominator === 0 ? null : dotProduct / cosineDenominator,
  };
  for (const [name, value] of Object.entries(metrics)) {
    if (value != null && typeof value === 'number' && !Number.isFinite(value)) {
      throw new RangeError(`${name} is outside the finite JavaScript number range`);
    }
  }

  return Object.freeze({
    schema: WEBGPU_PARITY_COMPARISON_SCHEMA,
    stageId: options.stageId == null ? null : requireIdentity('stageId', options.stageId),
    actualType,
    referenceType,
    sourceElementCount: actual.length,
    comparedElementCount: indices.length,
    sampling,
    nonFinite: Object.freeze({
      actual: actualNonFinite,
      reference: referenceNonFinite,
    }),
    actual: summarize(actual, indices),
    reference: summarize(reference, indices),
    metrics: Object.freeze(metrics),
  });
}

function cloneCapture(capture) {
  return Object.freeze({
    ...capture,
    shape: capture.shape == null ? null : Object.freeze([...capture.shape]),
    values: capture.values.slice(),
  });
}

export function createWebGpuParityCaptureRegistry({ runId } = {}) {
  requireIdentity('runId', runId);
  const captures = new Map();
  return Object.freeze({
    runId,
    capture(stageId, values, metadata = {}) {
      requireIdentity('stageId', stageId);
      const typedArrayConstructor = requireNumericTypedArray('values', values);
      if (!isPlainObject(metadata)) throw new TypeError('capture metadata must be an object');
      if (captures.has(stageId)) throw new Error(`capture ${stageId} already exists for run ${runId}`);
      const shape = normalizeShape(metadata.shape, values.length);
      const layout = metadata.layout == null ? null : requireIdentity('layout', metadata.layout);
      const capture = {
        schema: WEBGPU_PARITY_CAPTURE_SCHEMA,
        runId,
        stageId,
        typedArrayConstructor,
        elementCount: values.length,
        byteLength: values.byteLength,
        shape,
        layout,
        values: values.slice(),
      };
      captures.set(stageId, capture);
      return cloneCapture(capture);
    },
    get(stageId) {
      requireIdentity('stageId', stageId);
      const capture = captures.get(stageId);
      return capture == null ? null : cloneCapture(capture);
    },
    has(stageId) {
      requireIdentity('stageId', stageId);
      return captures.has(stageId);
    },
    stageIds() {
      return Object.freeze([...captures.keys()]);
    },
  });
}

function bytesToBase64(bytes) {
  let binary = '';
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + block, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(payload) {
  if (typeof payload !== 'string' || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new TypeError('payloadBase64 must be canonical base64');
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (bytesToBase64(bytes) !== payload) throw new TypeError('payloadBase64 must be canonical base64');
  return bytes;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto subtle.digest is required');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function captureBytes(capture) {
  return new Uint8Array(capture.values.buffer, capture.values.byteOffset, capture.values.byteLength);
}

export async function encodeWebGpuParityCaptureChunks(capture, options = {}) {
  if (!isPlainObject(capture) || capture.schema !== WEBGPU_PARITY_CAPTURE_SCHEMA) {
    throw new TypeError(`capture.schema must be ${WEBGPU_PARITY_CAPTURE_SCHEMA}`);
  }
  if (!isPlainObject(options)) throw new TypeError('options must be an object');
  requireIdentity('capture.runId', capture.runId);
  requireIdentity('capture.stageId', capture.stageId);
  const typedArrayConstructor = requireNumericTypedArray('capture.values', capture.values);
  if (typedArrayConstructor !== capture.typedArrayConstructor) {
    throw new TypeError('capture typedArrayConstructor must match values');
  }
  if (capture.elementCount !== capture.values.length || capture.byteLength !== capture.values.byteLength) {
    throw new RangeError('capture elementCount and byteLength must match values');
  }
  const shape = normalizeShape(capture.shape, capture.values.length);
  const chunkByteLength = options.chunkByteLength ?? 18 * 1024 * 1024;
  if (!Number.isSafeInteger(chunkByteLength) || chunkByteLength <= 0) {
    throw new TypeError('chunkByteLength must be a positive safe integer');
  }
  const bytes = captureBytes(capture);
  if (bytes.byteLength === 0) throw new RangeError('capture values must not be empty');
  const tensorSha256 = await sha256Hex(bytes);
  const chunkCount = Math.ceil(bytes.byteLength / chunkByteLength);
  const chunks = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const byteOffset = chunkIndex * chunkByteLength;
    const payload = bytes.subarray(byteOffset, Math.min(byteOffset + chunkByteLength, bytes.byteLength));
    chunks.push(Object.freeze({
      schema: WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA,
      captureSchema: WEBGPU_PARITY_CAPTURE_SCHEMA,
      runId: capture.runId,
      stageId: capture.stageId,
      typedArrayConstructor,
      elementCount: capture.elementCount,
      totalByteLength: capture.byteLength,
      shape,
      layout: capture.layout ?? null,
      byteOrder: PLATFORM_BYTE_ORDER,
      chunkIndex,
      chunkCount,
      byteOffset,
      byteLength: payload.byteLength,
      payloadBase64: bytesToBase64(payload),
      payloadSha256: await sha256Hex(payload),
      tensorSha256,
    }));
  }
  return Object.freeze(chunks);
}

function requireEqualMetadata(chunk, first, field, index) {
  const actual = JSON.stringify(chunk[field]);
  const expected = JSON.stringify(first[field]);
  if (actual !== expected) throw new Error(`chunk ${index} ${field} must match chunk 0`);
}

export async function decodeWebGpuParityCaptureChunks(chunks, options = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) throw new TypeError('chunks must be a non-empty array');
  if (!isPlainObject(options)) throw new TypeError('options must be an object');
  const first = chunks[0];
  if (!isPlainObject(first) || first.schema !== WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA) {
    throw new TypeError(`chunk schema must be ${WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA}`);
  }
  requireIdentity('chunk runId', first.runId);
  requireIdentity('chunk stageId', first.stageId);
  if (options.expectedRunId != null && first.runId !== options.expectedRunId) {
    throw new Error(`runId must match expected ${options.expectedRunId}`);
  }
  if (options.expectedStageId != null && first.stageId !== options.expectedStageId) {
    throw new Error(`stageId must match expected ${options.expectedStageId}`);
  }
  if (!Number.isSafeInteger(first.chunkCount) || first.chunkCount <= 0 || first.chunkCount !== chunks.length) {
    throw new RangeError('chunk count must match the declared chunkCount');
  }
  const Constructor = TYPED_ARRAYS.get(first.typedArrayConstructor);
  if (!Constructor) throw new TypeError('typedArrayConstructor is unsupported');
  if (!Number.isSafeInteger(first.totalByteLength) || first.totalByteLength <= 0) {
    throw new RangeError('totalByteLength must be a positive safe integer');
  }
  if (!Number.isSafeInteger(first.elementCount) || first.elementCount <= 0) {
    throw new RangeError('elementCount must be a positive safe integer');
  }
  if (first.totalByteLength !== first.elementCount * Constructor.BYTES_PER_ELEMENT) {
    throw new RangeError('totalByteLength must match elementCount and typed array width');
  }
  if (first.byteOrder !== PLATFORM_BYTE_ORDER) {
    throw new Error(`byteOrder ${first.byteOrder} cannot be decoded on this ${PLATFORM_BYTE_ORDER} host`);
  }
  const shape = normalizeShape(first.shape, first.elementCount);
  const output = new Uint8Array(first.totalByteLength);
  let nextByteOffset = 0;

  const commonFields = [
    'captureSchema', 'runId', 'stageId', 'typedArrayConstructor', 'elementCount',
    'totalByteLength', 'shape', 'layout', 'byteOrder', 'chunkCount', 'tensorSha256',
  ];
  for (const [index, chunk] of chunks.entries()) {
    if (!isPlainObject(chunk) || chunk.schema !== WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA) {
      throw new TypeError(`chunk ${index} has the wrong schema`);
    }
    for (const field of commonFields) requireEqualMetadata(chunk, first, field, index);
    if (chunk.chunkIndex !== index) throw new Error(`chunks must be ordered; chunkIndex ${index} expected`);
    if (chunk.byteOffset !== nextByteOffset) throw new Error('chunk byte offsets must be contiguous');
    const payload = base64ToBytes(chunk.payloadBase64);
    if (payload.byteLength !== chunk.byteLength) throw new RangeError('chunk payload byteLength mismatch');
    if (await sha256Hex(payload) !== chunk.payloadSha256) throw new Error('chunk payload digest mismatch');
    if (nextByteOffset + payload.byteLength > output.byteLength) {
      throw new RangeError('chunk payload exceeds totalByteLength');
    }
    output.set(payload, nextByteOffset);
    nextByteOffset += payload.byteLength;
  }
  if (nextByteOffset !== output.byteLength) throw new RangeError('chunk payloads do not cover totalByteLength');
  if (await sha256Hex(output) !== first.tensorSha256) throw new Error('tensor digest mismatch');

  return Object.freeze({
    schema: WEBGPU_PARITY_CAPTURE_SCHEMA,
    runId: first.runId,
    stageId: first.stageId,
    typedArrayConstructor: first.typedArrayConstructor,
    elementCount: first.elementCount,
    byteLength: first.totalByteLength,
    shape,
    layout: first.layout ?? null,
    values: new Constructor(output.buffer),
  });
}
