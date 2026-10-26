const MAX = 0xffff_ffff;
function uint(value, name, zero = false) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > MAX) throw new RangeError(`${name} is outside the WGSL u32 domain`);
  return value;
}
function span(last) { uint(last, 'last tensor element', true); }
function positiveFloat(value, name) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(Math.fround(value)) || Math.fround(value) === 0) throw new RangeError(`${name} must be a positive f32`);
}
export function affineParams({ tokens, rows, columns, group = 64, inputOffset = 0, inputStride = columns,
  weightRowOffset = 0, outputOffset = 0, outputStride = rows } = {}) {
  for (const [k, v] of Object.entries({ tokens, rows, columns, group, inputStride, outputStride })) uint(v, k);
  for (const [k, v] of Object.entries({ inputOffset, weightRowOffset, outputOffset })) uint(v, k, true);
  if (columns % 8 || group % 8 || columns % group || inputStride < columns || outputStride < rows) throw new RangeError('invalid affine4 shape/group/stride');
  span(inputOffset + (tokens - 1) * inputStride + columns - 1);
  span((weightRowOffset + rows) * (columns / 8) - 1);
  span((weightRowOffset + rows) * (columns / group) - 1);
  span(outputOffset + (tokens - 1) * outputStride + rows - 1);
  return new Uint32Array([tokens, rows, columns, group, inputOffset, inputStride, weightRowOffset, outputOffset, outputStride, 0, 0, 0]);
}
export function affineDispatch(rows, tokens, limit, { rowsPerGroup = 1 } = {}) {
  uint(rows, 'rows'); uint(tokens, 'tokens'); uint(limit, 'device dispatch limit');
  if (rowsPerGroup !== 1 && rowsPerGroup !== 4) throw new RangeError('unsupported affine rows per group');
  rows = Math.ceil(rows / rowsPerGroup);
  const x = Math.min(rows, limit), y = Math.ceil(rows / x);
  if (y > limit || tokens > limit) throw new RangeError('affine request exceeds the supplied device dispatch dimensions');
  return [x, y, tokens];
}
export function affineTiledDispatch(rows, tokens, limit) {
  uint(rows, 'rows'); uint(tokens, 'tokens');
  return affineDispatch(Math.ceil(rows / 32), Math.ceil(tokens / 32), limit);
}
export function deltaParams({ tokens, keyHeads, valueHeads, keyDim, valueDim, kernel = 4, epsilon = 1e-6 } = {}) {
  for (const [k, v] of Object.entries({ tokens, keyHeads, valueHeads, keyDim, valueDim, kernel })) uint(v, k);
  if (valueHeads % keyHeads) throw new RangeError('value heads must divide into key-head groups');
  const channels = 2 * keyHeads * keyDim + valueHeads * valueDim;
  const prepared = channels + 2 * valueHeads;
  span(tokens * prepared - 1); span(valueHeads * keyDim * valueDim - 1); span(kernel * channels - 1);
  positiveFloat(epsilon, 'epsilon');
  const words = new Uint32Array([tokens, keyHeads, valueHeads, keyDim, valueDim, kernel, channels, prepared, 0, 0, 0, 0]);
  new Float32Array(words.buffer)[8] = epsilon;
  return words;
}
export function attentionParams({ tokens, queryHeads, kvHeads, headDim, rotaryDim, pastTokens = 0,
  capacity, ropeTheta, epsilon = 1e-6 } = {}) {
  for (const [k, v] of Object.entries({ tokens, queryHeads, kvHeads, headDim, rotaryDim, capacity })) uint(v, k);
  uint(pastTokens, 'pastTokens', true);
  if (queryHeads % kvHeads || rotaryDim % 2 || rotaryDim > headDim || pastTokens + tokens > capacity) throw new RangeError('invalid attention geometry or cache capacity');
  positiveFloat(ropeTheta, 'ropeTheta'); positiveFloat(epsilon, 'epsilon');
  span(tokens * queryHeads * headDim * 2 - 1); span(capacity * kvHeads * headDim - 1);
  const words = new Uint32Array([tokens, queryHeads, kvHeads, headDim, rotaryDim, pastTokens, capacity, 0, 0, 0, 0, 0]);
  new Float32Array(words.buffer).set([ropeTheta, epsilon], 8);
  return words;
}
