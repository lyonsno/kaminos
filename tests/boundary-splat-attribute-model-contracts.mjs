import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../boundary-splat-attribute-model.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8').catch(() => '');

assert.match(source, /export function compileBoundarySplatAttributeModel/, 'attribute model compiler must be an explicit reusable module');

const {
  BOUNDARY_SPLAT_ATTRIBUTE_FEATURES,
  BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS,
  BOUNDARY_SPLAT_ATTRIBUTE_SCHEMA,
  compileBoundarySplatAttributeModel,
  evaluateBoundarySplatAttributeModel,
} = await import(moduleUrl);

const features = [
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
];
const outputs = ['color.r', 'color.g', 'color.b', 'opacity', 'radius.x', 'radius.y'];

assert.deepEqual(BOUNDARY_SPLAT_ATTRIBUTE_FEATURES, features, 'feature order is a public model contract');
assert.deepEqual(BOUNDARY_SPLAT_ATTRIBUTE_OUTPUTS, outputs, 'output order is a public model contract');
assert.equal(BOUNDARY_SPLAT_ATTRIBUTE_SCHEMA, 'kaminos-boundary-splat-attribute-mlp-v0');

const hiddenSize = 3;
const model = {
  schema: BOUNDARY_SPLAT_ATTRIBUTE_SCHEMA,
  architecture: 'dense-relu-dense',
  features,
  outputs,
  hiddenSize,
  outputRanges: [
    [0, 1],
    [0, 1],
    [0, 1],
    [0.001, 0.08],
    [0.25, 4],
    [0.25, 4],
  ],
  layers: [
    {
      inputSize: features.length,
      outputSize: hiddenSize,
      activation: 'relu',
      weights: Array.from({ length: features.length * hiddenSize }, (_, index) => (index - 12) / 100),
      bias: [0.1, -0.2, 0.3],
    },
    {
      inputSize: hiddenSize,
      outputSize: outputs.length,
      activation: 'linear',
      weights: Array.from({ length: hiddenSize * outputs.length }, (_, index) => (index + 1) / 50),
      bias: [-0.1, 0, 0.1, -0.2, 0.2, 0.3],
    },
  ],
};

const compiled = compileBoundarySplatAttributeModel(model);
const compiledAgain = compileBoundarySplatAttributeModel(structuredClone(model));

assert.match(compiled.identity, /^sha256:[a-f0-9]{64}$/, 'compiled artifact carries stable content identity');
assert.equal(compiled.identity, compiledAgain.identity, 'identical artifacts compile to identical identities');
assert.equal(compiled.wgsl, compiledAgain.wgsl, 'WGSL generation is deterministic');
assert.deepEqual(Array.from(compiled.packedWeights), Array.from(compiledAgain.packedWeights), 'packed weights are deterministic');
assert.equal(compiled.inputSize, features.length);
assert.equal(compiled.hiddenSize, hiddenSize);
assert.equal(compiled.outputSize, outputs.length);
assert.equal(compiled.packedWeights.length, features.length * hiddenSize + hiddenSize + hiddenSize * outputs.length + outputs.length);
assert.match(compiled.wgsl, /const BOUNDARY_SPLAT_ATTRIBUTE_INPUT_SIZE: u32 = 16u;/);
assert.match(compiled.wgsl, /const BOUNDARY_SPLAT_ATTRIBUTE_HIDDEN_SIZE: u32 = 3u;/);
assert.match(compiled.wgsl, /const BOUNDARY_SPLAT_ATTRIBUTE_OUTPUT_SIZE: u32 = 6u;/);
assert.match(compiled.wgsl, /fn inferBoundarySplatAttributes\(/, 'WGSL exposes one named inference function');
assert.match(compiled.wgsl, /clamp\(/, 'generated outputs are bounded by declared ranges');
const evaluated = evaluateBoundarySplatAttributeModel(model, [Array(features.length).fill(0.25)]);
assert.equal(evaluated.length, 1);
assert.equal(evaluated[0].length, outputs.length);
assert.ok(evaluated[0].every(Number.isFinite), 'CPU artifact evaluator produces finite parity outputs');
assert.throws(
  () => evaluateBoundarySplatAttributeModel(model, [[Number.NaN, ...Array(features.length - 1).fill(0)]]),
  /finite/i,
  'parity evaluator rejects non-finite features',
);

const reordered = structuredClone(model);
reordered.features = [...features].reverse();
assert.throws(
  () => compileBoundarySplatAttributeModel(reordered),
  /feature order/i,
  'feature order drift fails loud',
);

const wrongShape = structuredClone(model);
wrongShape.layers[0].weights.pop();
assert.throws(
  () => compileBoundarySplatAttributeModel(wrongShape),
  /weights.*48/i,
  'tensor shape mismatch fails loud',
);

const nonFinite = structuredClone(model);
nonFinite.layers[1].bias[2] = Number.NaN;
assert.throws(
  () => compileBoundarySplatAttributeModel(nonFinite),
  /finite/i,
  'non-finite parameters fail loud',
);

const invalidRange = structuredClone(model);
invalidRange.outputRanges[3] = [0.08, 0.001];
assert.throws(
  () => compileBoundarySplatAttributeModel(invalidRange),
  /output range/i,
  'reversed output ranges fail loud',
);

const changedWeights = structuredClone(model);
changedWeights.layers[0].weights[0] += 0.001;
assert.notEqual(
  compileBoundarySplatAttributeModel(changedWeights).identity,
  compiled.identity,
  'weight changes alter model identity',
);

console.log('boundary splat attribute model contracts passed');
