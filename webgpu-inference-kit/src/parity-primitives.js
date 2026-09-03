export const WEBGPU_PARITY_COMPARISON_SCHEMA = 'kaminos.webgpu-parity-comparison.v0';
export const WEBGPU_PARITY_CAPTURE_SCHEMA = 'kaminos.webgpu-parity-capture.v0';
export const WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA = 'kaminos.webgpu-parity-capture-chunk.v0';
export const WEBGPU_PARITY_CAPTURE_MANIFEST_SCHEMA = 'kaminos.webgpu-parity-capture-manifest.v0';

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
  if (sampling == null) {
    return Object.freeze({
      mode: 'all',
      stride: 1,
      offset: 0,
      firstSourceIndex: sourceElementCount === 0 ? null : 0,
      lastSourceIndex: sourceElementCount === 0 ? null : sourceElementCount - 1,
    });
  }
  if (!isPlainObject(sampling)) throw new TypeError('sampling must be an object');
  if (sampling.mode === 'all') {
    const stride = sampling.stride ?? 1;
    const offset = sampling.offset ?? 0;
    if (stride !== 1 || offset !== 0) {
      throw new TypeError('sampling mode all requires stride 1 and offset 0');
    }
    return Object.freeze({
      mode: 'all',
      stride,
      offset,
      firstSourceIndex: sourceElementCount === 0 ? null : 0,
      lastSourceIndex: sourceElementCount === 0 ? null : sourceElementCount - 1,
    });
  }
  if (sampling.mode !== 'stride') {
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
  let count = 0;
  let mean = 0;
  let scale = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const index of indices) {
    const value = values[index];
    count += 1;
    mean = mean * ((count - 1) / count) + value / count;
    scale = Math.max(scale, Math.abs(value));
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  let normalizedSquaredDeviation = 0;
  let compensation = 0;
  if (scale > 0) {
    const normalizedMean = mean / scale;
    for (const index of indices) {
      const deviation = values[index] / scale - normalizedMean;
      const squared = deviation * deviation;
      const adjusted = squared - compensation;
      const next = normalizedSquaredDeviation + adjusted;
      compensation = (next - normalizedSquaredDeviation) - adjusted;
      normalizedSquaredDeviation = next;
    }
  }
  const standardDeviation = scale * Math.sqrt(Math.max(0, normalizedSquaredDeviation / count));
  if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation)) {
    throw new RangeError('value summary is outside the finite JavaScript number range');
  }
  return Object.freeze({ min, max, mean, standardDeviation });
}

function createScaledNormAccumulator() {
  let scale = 0;
  let scaledSquares = 1;
  return {
    add(value) {
      const absolute = Math.abs(value);
      if (absolute === 0) return;
      if (scale < absolute) {
        const ratio = scale / absolute;
        scaledSquares = 1 + scaledSquares * ratio * ratio;
        scale = absolute;
      } else {
        const ratio = absolute / scale;
        scaledSquares += ratio * ratio;
      }
    },
    value() {
      return scale === 0 ? 0 : scale * Math.sqrt(scaledSquares);
    },
    ratioTo(other) {
      if (scale === 0) return 0;
      if (other.scale() === 0) return Number.POSITIVE_INFINITY;
      const logRatio = Math.log(scale) - Math.log(other.scale())
        + 0.5 * (Math.log(scaledSquares) - Math.log(other.scaledSquares()));
      return Math.exp(logRatio);
    },
    scale() {
      return scale;
    },
    scaledSquares() {
      return scaledSquares;
    },
  };
}

function compensatedAdd(state, value) {
  const adjusted = value - state.compensation;
  const next = state.sum + adjusted;
  state.compensation = (next - state.sum) - adjusted;
  state.sum = next;
}

function stableCosineSimilarity(actual, reference, indices) {
  let actualScale = 0;
  let referenceScale = 0;
  for (const index of indices) {
    actualScale = Math.max(actualScale, Math.abs(actual[index]));
    referenceScale = Math.max(referenceScale, Math.abs(reference[index]));
  }
  if (actualScale === 0 || referenceScale === 0) return null;

  const dot = { sum: 0, compensation: 0 };
  const actualSquares = { sum: 0, compensation: 0 };
  const referenceSquares = { sum: 0, compensation: 0 };
  for (const index of indices) {
    const scaledActual = actual[index] / actualScale;
    const scaledReference = reference[index] / referenceScale;
    compensatedAdd(dot, scaledActual * scaledReference);
    compensatedAdd(actualSquares, scaledActual * scaledActual);
    compensatedAdd(referenceSquares, scaledReference * scaledReference);
  }
  const denominator = Math.sqrt(actualSquares.sum * referenceSquares.sum);
  return denominator === 0 ? null : Math.max(-1, Math.min(1, dot.sum / denominator));
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

  let meanAbsoluteError = 0;
  let errorCount = 0;
  const errorNormAccumulator = createScaledNormAccumulator();
  const referenceNormAccumulator = createScaledNormAccumulator();
  let maxAbsoluteError = -1;
  let worstSourceIndex = null;
  for (const index of indices) {
    const actualValue = actual[index];
    const referenceValue = reference[index];
    const absoluteError = Math.abs(actualValue - referenceValue);
    errorCount += 1;
    meanAbsoluteError = meanAbsoluteError * ((errorCount - 1) / errorCount)
      + absoluteError / errorCount;
    errorNormAccumulator.add(absoluteError);
    referenceNormAccumulator.add(referenceValue);
    if (absoluteError > maxAbsoluteError) {
      maxAbsoluteError = absoluteError;
      worstSourceIndex = index;
    }
  }

  const l2Error = errorNormAccumulator.value();
  let relativeL2Error;
  let relativeL2Status;
  if (referenceNormAccumulator.scale() === 0) {
    relativeL2Error = l2Error === 0 ? 0 : null;
    relativeL2Status = l2Error === 0 ? 'defined' : 'infinite-zero-reference-norm';
  } else {
    const ratio = errorNormAccumulator.ratioTo(referenceNormAccumulator);
    relativeL2Error = Number.isFinite(ratio) ? ratio : null;
    relativeL2Status = Number.isFinite(ratio) ? 'defined' : 'outside-finite-range';
  }
  const metrics = {
    maxAbsoluteError,
    worstSourceIndex,
    worstActual: actual[worstSourceIndex],
    worstReference: reference[worstSourceIndex],
    meanAbsoluteError,
    rootMeanSquareError: l2Error / Math.sqrt(indices.length),
    l2Error,
    relativeL2Error,
    relativeL2Status,
    cosineSimilarity: stableCosineSimilarity(actual, reference, indices),
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

function createCaptureManifest(fields, chunkPlan) {
  return {
    schema: WEBGPU_PARITY_CAPTURE_MANIFEST_SCHEMA,
    captureSchema: WEBGPU_PARITY_CAPTURE_SCHEMA,
    runId: fields.runId,
    stageId: fields.stageId,
    typedArrayConstructor: fields.typedArrayConstructor,
    elementCount: fields.elementCount,
    totalByteLength: fields.totalByteLength,
    shape: fields.shape,
    layout: fields.layout,
    byteOrder: fields.byteOrder,
    chunkCount: chunkPlan.length,
    chunkPlan,
    tensorSha256: fields.tensorSha256,
  };
}

async function digestCaptureManifest(manifest) {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(manifest)));
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
  const layout = capture.layout == null ? null : requireIdentity('capture.layout', capture.layout);
  const chunkByteLength = options.chunkByteLength ?? 18 * 1024 * 1024;
  if (!Number.isSafeInteger(chunkByteLength) || chunkByteLength <= 0) {
    throw new TypeError('chunkByteLength must be a positive safe integer');
  }
  // Snapshot before the first await so one encoded artifact cannot mix caller
  // mutations from different points in the asynchronous digest sequence.
  const bytes = captureBytes(capture).slice();
  if (bytes.byteLength === 0) throw new RangeError('capture values must not be empty');
  const chunkCount = Math.ceil(bytes.byteLength / chunkByteLength);
  const chunkPlan = Object.freeze(Array.from({ length: chunkCount }, (_, chunkIndex) => {
    const byteOffset = chunkIndex * chunkByteLength;
    return Object.freeze({
      chunkIndex,
      byteOffset,
      byteLength: Math.min(chunkByteLength, bytes.byteLength - byteOffset),
    });
  }));
  const tensorSha256 = await sha256Hex(bytes);
  const captureManifest = createCaptureManifest({
    runId: capture.runId,
    stageId: capture.stageId,
    typedArrayConstructor,
    elementCount: capture.elementCount,
    totalByteLength: capture.byteLength,
    shape,
    layout,
    byteOrder: PLATFORM_BYTE_ORDER,
    tensorSha256,
  }, chunkPlan);
  const captureSha256 = await digestCaptureManifest(captureManifest);
  const chunks = [];
  for (const plan of chunkPlan) {
    const { chunkIndex, byteOffset, byteLength } = plan;
    const payload = bytes.subarray(byteOffset, byteOffset + byteLength);
    chunks.push(Object.freeze({
      schema: WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA,
      captureSchema: WEBGPU_PARITY_CAPTURE_SCHEMA,
      runId: capture.runId,
      stageId: capture.stageId,
      typedArrayConstructor,
      elementCount: capture.elementCount,
      totalByteLength: capture.byteLength,
      shape,
      layout,
      byteOrder: PLATFORM_BYTE_ORDER,
      chunkIndex,
      chunkCount,
      byteOffset,
      byteLength,
      payloadBase64: bytesToBase64(payload),
      payloadSha256: await sha256Hex(payload),
      tensorSha256,
      captureSha256,
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
  if (!isPlainObject(options.expectedCapture)) {
    throw new TypeError('expectedCapture with runId and stageId is required');
  }
  const expectedCapture = options.expectedCapture;
  requireIdentity('expectedCapture.runId', expectedCapture.runId);
  requireIdentity('expectedCapture.stageId', expectedCapture.stageId);
  const first = chunks[0];
  if (!isPlainObject(first) || first.schema !== WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA) {
    throw new TypeError(`chunk schema must be ${WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA}`);
  }
  if (first.captureSchema !== WEBGPU_PARITY_CAPTURE_SCHEMA) {
    throw new TypeError(`capture schema must be ${WEBGPU_PARITY_CAPTURE_SCHEMA}`);
  }
  requireIdentity('chunk runId', first.runId);
  requireIdentity('chunk stageId', first.stageId);
  if (first.runId !== expectedCapture.runId) {
    throw new Error(`runId must match expected ${expectedCapture.runId}`);
  }
  if (first.stageId !== expectedCapture.stageId) {
    throw new Error(`stageId must match expected ${expectedCapture.stageId}`);
  }
  if (!Number.isSafeInteger(first.chunkCount) || first.chunkCount <= 0 || first.chunkCount !== chunks.length) {
    throw new RangeError('chunk count must match the declared chunkCount');
  }
  const Constructor = TYPED_ARRAYS.get(first.typedArrayConstructor);
  if (!Constructor) throw new TypeError('typedArrayConstructor is unsupported');
  if (
    expectedCapture.typedArrayConstructor != null
    && first.typedArrayConstructor !== expectedCapture.typedArrayConstructor
  ) {
    throw new Error('typedArrayConstructor must match expectedCapture');
  }
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
  if (expectedCapture.shape != null) {
    const expectedShape = normalizeShape(expectedCapture.shape, first.elementCount);
    if (JSON.stringify(shape) !== JSON.stringify(expectedShape)) {
      throw new Error('shape must match expectedCapture');
    }
  }
  if (first.layout != null) requireIdentity('chunk layout', first.layout);
  if (Object.hasOwn(expectedCapture, 'layout')) {
    if (expectedCapture.layout != null) requireIdentity('expectedCapture.layout', expectedCapture.layout);
    if (first.layout !== expectedCapture.layout) throw new Error('layout must match expectedCapture');
  }
  const output = new Uint8Array(first.totalByteLength);
  let nextByteOffset = 0;

  const commonFields = [
    'captureSchema', 'runId', 'stageId', 'typedArrayConstructor', 'elementCount',
    'totalByteLength', 'shape', 'layout', 'byteOrder', 'chunkCount', 'tensorSha256',
    'captureSha256',
  ];
  const chunkPlan = [];
  for (const [index, chunk] of chunks.entries()) {
    if (!isPlainObject(chunk) || chunk.schema !== WEBGPU_PARITY_CAPTURE_CHUNK_SCHEMA) {
      throw new TypeError(`chunk ${index} has the wrong schema`);
    }
    for (const field of commonFields) requireEqualMetadata(chunk, first, field, index);
    if (chunk.chunkIndex !== index) throw new Error(`chunks must be ordered; chunkIndex ${index} expected`);
    if (chunk.byteOffset !== nextByteOffset) throw new Error('chunk byte offsets must be contiguous');
    if (!Number.isSafeInteger(chunk.byteLength) || chunk.byteLength <= 0) {
      throw new RangeError('chunk byteLength must be a positive safe integer');
    }
    chunkPlan.push(Object.freeze({
      chunkIndex: chunk.chunkIndex,
      byteOffset: chunk.byteOffset,
      byteLength: chunk.byteLength,
    }));
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
  const captureManifest = createCaptureManifest({
    runId: first.runId,
    stageId: first.stageId,
    typedArrayConstructor: first.typedArrayConstructor,
    elementCount: first.elementCount,
    totalByteLength: first.totalByteLength,
    shape,
    layout: first.layout ?? null,
    byteOrder: first.byteOrder,
    tensorSha256: first.tensorSha256,
  }, chunkPlan);
  if (await digestCaptureManifest(captureManifest) !== first.captureSha256) {
    throw new Error('capture digest mismatch');
  }

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
