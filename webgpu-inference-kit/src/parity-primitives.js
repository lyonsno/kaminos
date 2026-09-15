export const WEBGPU_PARITY_COMPARISON_SCHEMA = 'kaminos.webgpu-parity-comparison.v0';
export const WEBGPU_PARITY_CAPTURE_SCHEMA = 'kaminos.webgpu-parity-capture.v0';

const TYPED_ARRAYS = new Map([
  ['Int8Array', Int8Array],
  ['Uint8Array', Uint8Array],
  ['Uint8ClampedArray', Uint8ClampedArray],
  ['Int16Array', Int16Array],
  ['Uint16Array', Uint16Array],
  ['Int32Array', Int32Array],
  ['Uint32Array', Uint32Array],
  ['Float32Array', Float32Array],
]);

const INTEGER_TYPED_ARRAYS = new Set([
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
]);

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
  if (constructorName === 'Float64Array') {
    throw new TypeError(
      `${name} Float64Array is unsupported; compare WebGPU floating tensors as Float32Array after FP16 decoding`,
    );
  }
  if (!ArrayBuffer.isView(value) || value instanceof DataView || !TYPED_ARRAYS.has(constructorName)) {
    throw new TypeError(`${name} must be a supported WebGPU parity typed array`);
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
  const sum = { sum: 0, compensation: 0 };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const index of indices) {
    const value = values[index];
    compensatedAdd(sum, value);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const mean = compensatedValue(sum) / indices.length;
  const squaredDeviations = { sum: 0, compensation: 0 };
  for (const index of indices) {
    const deviation = values[index] - mean;
    compensatedAdd(squaredDeviations, deviation * deviation);
  }
  const standardDeviation = Math.sqrt(
    Math.max(0, compensatedValue(squaredDeviations) / indices.length),
  );
  if (!Number.isFinite(mean) || !Number.isFinite(standardDeviation)) {
    throw new RangeError('value summary is outside the declared WebGPU tensor domain');
  }
  return Object.freeze({ min, max, mean, standardDeviation });
}

function createNormAccumulator() {
  const squares = { sum: 0, compensation: 0 };
  return {
    add(value) {
      compensatedAdd(squares, value * value);
    },
    value() {
      return Math.sqrt(Math.max(0, compensatedValue(squares)));
    },
  };
}

function compensatedAdd(state, value) {
  const next = state.sum + value;
  if (Math.abs(state.sum) >= Math.abs(value)) {
    state.compensation += (state.sum - next) + value;
  } else {
    state.compensation += (value - next) + state.sum;
  }
  state.sum = next;
}

function compensatedValue(state) {
  return state.sum + state.compensation;
}

function stableCosineSimilarity(actual, reference, indices) {
  const dot = { sum: 0, compensation: 0 };
  const actualSquares = { sum: 0, compensation: 0 };
  const referenceSquares = { sum: 0, compensation: 0 };
  for (const index of indices) {
    compensatedAdd(dot, actual[index] * reference[index]);
    compensatedAdd(actualSquares, actual[index] * actual[index]);
    compensatedAdd(referenceSquares, reference[index] * reference[index]);
  }
  const denominator = Math.sqrt(compensatedValue(actualSquares))
    * Math.sqrt(compensatedValue(referenceSquares));
  return denominator === 0
    ? null
    : Math.max(-1, Math.min(1, compensatedValue(dot) / denominator));
}

export function compareWebGpuParityArrays(actual, reference, options = {}) {
  const actualType = requireNumericTypedArray('actual', actual);
  const referenceType = requireNumericTypedArray('reference', reference);
  if (!isPlainObject(options)) throw new TypeError('options must be an object');
  if (actualType !== referenceType) {
    throw new TypeError('actual and reference must use the same typed array constructor');
  }
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

  const absoluteErrors = { sum: 0, compensation: 0 };
  const errorNormAccumulator = createNormAccumulator();
  const referenceNormAccumulator = createNormAccumulator();
  let maxAbsoluteError = -1;
  let worstSourceIndex = null;
  let mismatchCount = 0;
  for (const index of indices) {
    const actualValue = actual[index];
    const referenceValue = reference[index];
    const absoluteError = Math.abs(actualValue - referenceValue);
    compensatedAdd(absoluteErrors, absoluteError);
    errorNormAccumulator.add(absoluteError);
    referenceNormAccumulator.add(referenceValue);
    if (actualValue !== referenceValue) mismatchCount += 1;
    if (absoluteError > maxAbsoluteError) {
      maxAbsoluteError = absoluteError;
      worstSourceIndex = index;
    }
  }

  const l2Error = errorNormAccumulator.value();
  let relativeL2Error;
  let relativeL2Status;
  const referenceL2Norm = referenceNormAccumulator.value();
  if (referenceL2Norm === 0) {
    relativeL2Error = l2Error === 0 ? 0 : null;
    relativeL2Status = l2Error === 0 ? 'defined' : 'infinite-zero-reference-norm';
  } else {
    relativeL2Error = l2Error / referenceL2Norm;
    relativeL2Status = 'defined';
  }
  const metrics = {
    exactMatch: mismatchCount === 0,
    mismatchCount,
    maxAbsoluteError,
    worstSourceIndex,
    worstActual: actual[worstSourceIndex],
    worstReference: reference[worstSourceIndex],
    meanAbsoluteError: compensatedValue(absoluteErrors) / indices.length,
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
    comparisonDomain: Object.freeze({
      mode: INTEGER_TYPED_ARRAYS.has(actualType) ? 'integer-exact' : 'float32-metrics',
      effectiveType: actualType,
      normalization: 'none',
    }),
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

export function createWebGpuParityCaptureRegistry({ runId } = {}) {
  requireIdentity('runId', runId);
  const captures = new Map();

  function requireCapture(stageId) {
    requireIdentity('stageId', stageId);
    const capture = captures.get(stageId);
    if (!capture) throw new Error(`capture ${stageId} is missing from run ${runId}`);
    return capture;
  }

  return Object.freeze({
    runId,
    capture(stageId, values, metadata = {}) {
      requireIdentity('stageId', stageId);
      const typedArrayConstructor = requireNumericTypedArray('values', values);
      if (values.length === 0) throw new RangeError('capture values must not be empty');
      if (!isPlainObject(metadata)) throw new TypeError('capture metadata must be an object');
      if (captures.has(stageId)) throw new Error(`capture ${stageId} already exists for run ${runId}`);
      const { shape: suppliedShape, layout: suppliedLayout } = metadata;
      const shape = normalizeShape(suppliedShape, values.length);
      const layout = suppliedLayout == null ? null : requireIdentity('layout', suppliedLayout);
      const description = Object.freeze({
        schema: WEBGPU_PARITY_CAPTURE_SCHEMA,
        runId,
        stageId,
        typedArrayConstructor,
        elementCount: values.length,
        byteLength: values.byteLength,
        shape,
        layout,
      });
      captures.set(stageId, { description, values: values.slice() });
      return description;
    },
    describe(stageId) {
      requireIdentity('stageId', stageId);
      return captures.get(stageId)?.description ?? null;
    },
    compare(stageId, reference, options = {}) {
      const capture = requireCapture(stageId);
      if (!isPlainObject(options)) throw new TypeError('options must be an object');
      return Object.freeze({
        ...compareWebGpuParityArrays(capture.values, reference, { ...options, stageId }),
        runId,
      });
    },
    readBytes(stageId, { byteOffset, byteLength } = {}) {
      const { values } = requireCapture(stageId);
      if (!Number.isSafeInteger(byteOffset) || byteOffset < 0
        || !Number.isSafeInteger(byteLength) || byteLength < 0
        || byteOffset > values.byteLength || byteLength > values.byteLength - byteOffset) {
        throw new RangeError('byte range must be inside the captured tensor');
      }
      return new Uint8Array(values.buffer, values.byteOffset + byteOffset, byteLength).slice();
    },
    release(stageId) {
      requireIdentity('stageId', stageId);
      return captures.delete(stageId);
    },
    clear() {
      captures.clear();
    },
    stageIds() {
      return Object.freeze([...captures.keys()]);
    },
  });
}
