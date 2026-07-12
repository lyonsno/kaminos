import { createHash } from 'node:crypto';

export const BOUNDARY_SPLAT_ATTRIBUTE_SCHEMA = 'kaminos-boundary-splat-attribute-mlp-v0';

export const BOUNDARY_SPLAT_ATTRIBUTE_FEATURES = Object.freeze([
  'sidecar.support',
  'sidecar.coverage',
  'sidecar.ridge',
  'sidecar.footprint',
  'material.density',
  'material.heat',
  'material.fuel',
  'material.detail',
  'fire.energy',
  'fire.temperature',
  'fire.emission',
  'fire.detail',
  'micro.x',
  'micro.y',
  'micro.z',
  'micro.w',
]);

export const BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS = Object.freeze([
  'color.r',
  'color.g',
  'color.b',
  'opacity',
  'radius.x',
  'radius.y',
]);

function assertExactOrder(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} order must equal ${JSON.stringify(expected)}`);
  }
}

function assertFiniteArray(values, expectedLength, label) {
  if (!Array.isArray(values) || values.length !== expectedLength) {
    throw new Error(`${label} must contain exactly ${expectedLength} values`);
  }
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${label} values must be finite numbers`);
    }
  }
}

function validateLayer(layer, expectedInputSize, expectedOutputSize, expectedActivation, index) {
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
    throw new Error(`layer ${index} must be an object`);
  }
  if (layer.inputSize !== expectedInputSize || layer.outputSize !== expectedOutputSize) {
    throw new Error(`layer ${index} shape must be ${expectedInputSize} -> ${expectedOutputSize}`);
  }
  if (layer.activation !== expectedActivation) {
    throw new Error(`layer ${index} activation must be ${expectedActivation}`);
  }
  assertFiniteArray(layer.weights, expectedInputSize * expectedOutputSize, `layer ${index} weights`);
  assertFiniteArray(layer.bias, expectedOutputSize, `layer ${index} bias`);
}

function validateOutputRanges(outputRanges) {
  if (!Array.isArray(outputRanges) || outputRanges.length !== BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS.length) {
    throw new Error(`output ranges must contain ${BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS.length} entries`);
  }
  outputRanges.forEach((range, index) => {
    if (!Array.isArray(range) || range.length !== 2 || range.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`output range ${index} must contain two finite numbers`);
    }
    if (range[0] >= range[1]) {
      throw new Error(`output range ${index} lower bound must be less than upper bound`);
    }
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter(key => key !== 'identity')
        .sort()
        .map(key => [key, canonicalize(value[key])]),
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function wgslFloat(value) {
  if (!Number.isFinite(value)) throw new Error('WGSL values must be finite');
  if (Object.is(value, -0) || value === 0) return '0.0';
  const rendered = Number(value).toString();
  return /[.eE]/.test(rendered) ? rendered : `${rendered}.0`;
}

function generateWgsl({ identity, hiddenSize, outputRanges, packedWeights }) {
  const inputSize = BOUNDARY_SPLAT_ATTRIBUTE_FEATURES.length;
  const outputSize = BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS.length;
  const firstWeightCount = inputSize * hiddenSize;
  const firstBiasOffset = firstWeightCount;
  const secondWeightOffset = firstBiasOffset + hiddenSize;
  const secondBiasOffset = secondWeightOffset + hiddenSize * outputSize;
  const weights = Array.from(packedWeights, wgslFloat).join(', ');
  const ranges = outputRanges.flat().map(wgslFloat).join(', ');
  return `
const BOUNDARY_SPLAT_ATTRIBUTE_MODEL_IDENTITY: u32 = 0x${identity.slice(7, 15)}u;
const BOUNDARY_SPLAT_ATTRIBUTE_INPUT_SIZE: u32 = ${inputSize}u;
const BOUNDARY_SPLAT_ATTRIBUTE_HIDDEN_SIZE: u32 = ${hiddenSize}u;
const BOUNDARY_SPLAT_ATTRIBUTE_OUTPUT_SIZE: u32 = ${outputSize}u;
const BOUNDARY_SPLAT_ATTRIBUTE_FIRST_BIAS_OFFSET: u32 = ${firstBiasOffset}u;
const BOUNDARY_SPLAT_ATTRIBUTE_SECOND_WEIGHT_OFFSET: u32 = ${secondWeightOffset}u;
const BOUNDARY_SPLAT_ATTRIBUTE_SECOND_BIAS_OFFSET: u32 = ${secondBiasOffset}u;
const boundarySplatAttributeWeights = array<f32, ${packedWeights.length}>(${weights});
const boundarySplatAttributeOutputRanges = array<f32, ${outputSize * 2}>(${ranges});

struct BoundarySplatAttributeOutput {
  colorOpacity: vec4<f32>,
  radiusScale: vec2<f32>,
};

fn boundarySplatAttributeSigmoid(value: f32) -> f32 {
  return 1.0 / (1.0 + exp(-clamp(value, -16.0, 16.0)));
}

fn boundarySplatAttributeRange(raw: f32, outputIndex: u32) -> f32 {
  let lower = boundarySplatAttributeOutputRanges[outputIndex * 2u];
  let upper = boundarySplatAttributeOutputRanges[outputIndex * 2u + 1u];
  return clamp(mix(lower, upper, boundarySplatAttributeSigmoid(raw)), lower, upper);
}

fn inferBoundarySplatAttributes(features: array<f32, ${inputSize}>) -> BoundarySplatAttributeOutput {
  var hidden: array<f32, ${hiddenSize}>;
  for (var hiddenIndex = 0u; hiddenIndex < BOUNDARY_SPLAT_ATTRIBUTE_HIDDEN_SIZE; hiddenIndex += 1u) {
    var value = boundarySplatAttributeWeights[BOUNDARY_SPLAT_ATTRIBUTE_FIRST_BIAS_OFFSET + hiddenIndex];
    for (var inputIndex = 0u; inputIndex < BOUNDARY_SPLAT_ATTRIBUTE_INPUT_SIZE; inputIndex += 1u) {
      value += features[inputIndex] * boundarySplatAttributeWeights[hiddenIndex * BOUNDARY_SPLAT_ATTRIBUTE_INPUT_SIZE + inputIndex];
    }
    hidden[hiddenIndex] = max(value, 0.0);
  }
  var raw: array<f32, ${outputSize}>;
  for (var outputIndex = 0u; outputIndex < BOUNDARY_SPLAT_ATTRIBUTE_OUTPUT_SIZE; outputIndex += 1u) {
    var value = boundarySplatAttributeWeights[BOUNDARY_SPLAT_ATTRIBUTE_SECOND_BIAS_OFFSET + outputIndex];
    for (var hiddenIndex = 0u; hiddenIndex < BOUNDARY_SPLAT_ATTRIBUTE_HIDDEN_SIZE; hiddenIndex += 1u) {
      value += hidden[hiddenIndex] * boundarySplatAttributeWeights[BOUNDARY_SPLAT_ATTRIBUTE_SECOND_WEIGHT_OFFSET + outputIndex * BOUNDARY_SPLAT_ATTRIBUTE_HIDDEN_SIZE + hiddenIndex];
    }
    raw[outputIndex] = boundarySplatAttributeRange(value, outputIndex);
  }
  var result: BoundarySplatAttributeOutput;
  result.colorOpacity = vec4<f32>(raw[0], raw[1], raw[2], raw[3]);
  result.radiusScale = vec2<f32>(raw[4], raw[5]);
  return result;
}
`.trim();
}

export function compileBoundarySplatAttributeModel(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error('attribute model must be an object');
  }
  if (model.schema !== BOUNDARY_SPLAT_ATTRIBUTE_SCHEMA) {
    throw new Error(`attribute model schema must be ${BOUNDARY_SPLAT_ATTRIBUTE_SCHEMA}`);
  }
  if (model.architecture !== 'dense-relu-dense') {
    throw new Error('attribute model architecture must be dense-relu-dense');
  }
  assertExactOrder(model.features, BOUNDARY_SPLAT_ATTRIBUTE_FEATURES, 'feature');
  assertExactOrder(model.outputs, BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS, 'output');
  if (!Number.isInteger(model.hiddenSize) || model.hiddenSize <= 0) {
    throw new Error('hiddenSize must be a positive integer');
  }
  if (!Array.isArray(model.layers) || model.layers.length !== 2) {
    throw new Error('attribute model must contain exactly two layers');
  }
  validateLayer(model.layers[0], BOUNDARY_SPLAT_ATTRIBUTE_FEATURES.length, model.hiddenSize, 'relu', 0);
  validateLayer(model.layers[1], model.hiddenSize, BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS.length, 'linear', 1);
  validateOutputRanges(model.outputRanges);

  const canonical = canonicalJson(model);
  const identity = `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
  if (model.identity != null && model.identity !== identity) {
    throw new Error(`attribute model identity mismatch: expected ${identity}`);
  }
  const packedWeights = new Float32Array([
    ...model.layers[0].weights,
    ...model.layers[0].bias,
    ...model.layers[1].weights,
    ...model.layers[1].bias,
  ]);
  return {
    schema: BOUNDARY_SPLAT_ATTRIBUTE_SCHEMA,
    identity,
    canonical,
    inputSize: BOUNDARY_SPLAT_ATTRIBUTE_FEATURES.length,
    hiddenSize: model.hiddenSize,
    outputSize: BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS.length,
    packedWeights,
    wgsl: generateWgsl({ identity, hiddenSize: model.hiddenSize, outputRanges: model.outputRanges, packedWeights }),
  };
}
