import assert from 'node:assert/strict';
import * as admission from '../sparse-decoder-witness-checks.js';
import { buildSLatDecoderPlan, slatDecoderWeightShapes } from '../slat-decoder.js';
assert.equal(typeof admission.validateSLatDecoderFixture, 'function',
  'Actual learned-decoder conformance needs source/precision/complete-output admission, not a successful dispatch alone.');
const { validateSLatDecoderFixture, SLAT_DECODER_REFERENCE_ROUTE, compareLearnedSubdivision, compareHalfRoundTrip } = admission;
const config = { tokenRows: 3, latentChannels: 2, resolution: 2, channels: [16, 8], numBlocks: [1, 0], mode: 'shape' };
const plan = buildSLatDecoderPlan(config), shapes = slatDecoderWeightShapes(plan);
const descriptor = (name, shape, integer = false, half = false) => ({ file: name + (integer ? '.i32' : '.f32'), shape,
  dtype: integer ? 'int32' : 'float32', sourceDtype: integer ? 'int32' : half ? 'float16' : 'float32',
  byteLength: shape.reduce((a, b) => a * b, 4), sha256: 'a'.repeat(64) });
const manifest = { schema: 'trellis2.slat-decoder-reference.v0', status: 'succeeded', referenceRoute: SLAT_DECODER_REFERENCE_ROUTE,
  config, modelCalls: 1, convolutionsExecuted: 3, parameterCount: Object.values(shapes).reduce((n, s) => n + s.reduce((a, b) => a * b, 1), 0),
  fixtureKind: 'synthetic-operation-conformance', outputRows: 12, outputResolution: 4, subdivisionRows: [[3, 8]],
  source: { commit: 'b'.repeat(40), dirty: '' }, producer: { commit: 'c'.repeat(40), dirty: '' },
  sourceAfter: { commit: 'b'.repeat(40), dirty: '' }, producerAfter: { commit: 'c'.repeat(40), dirty: '' },
  effectiveBackend: { device: 'Device(gpu, 0)', arithmetic: plan.arithmetic, weightLayout: plan.weightLayout,
    normEpsilon: 1e-6, terminalNormEpsilon: 1e-5, sourceModel: 'actual SLatDecoder.__call__',
    route: { decoder_linear_backend: 'native', sparse_conv_matmul_backend: 'native',
      decoder_silu: { backend: 'mlx-native' }, decoder_layernorm: { backend: 'mlx-fast-layer-norm' } } },
  tensors: { sample: descriptor('sample', [3, 2]), coordinates: descriptor('coordinates', [3, 3], true),
    silu: descriptor('silu', [65536], false, true), halfInputs: descriptor('halfInputs', [65536]),
    'expected.features': descriptor('expected.features', [12, 7]), 'expected.coordinates': descriptor('expected.coordinates', [12, 3], true),
    'expected.subdivision0': descriptor('expected.subdivision0', [3, 8], false, true),
    ...Object.fromEntries(Object.entries(shapes).map(([n, s]) => ['weight.' + n, descriptor('weight.' + n, s, false, n.startsWith('blocks.'))])) }
};
assert.equal(validateSLatDecoderFixture(manifest).mode, 'shape');
validateSLatDecoderFixture({ ...manifest, futureField: 'additive compatibility' });
for (const mutate of [m => m.referenceRoute = 'cpu-fallback', m => m.modelCalls = 0,
  m => m.sourceAfter.commit = 'd'.repeat(40), m => m.effectiveBackend.arithmetic = 'f32',
  m => m.effectiveBackend.route.sparse_conv_matmul_backend = 'turing_fda',
  m => m.tensors['weight.blocks.0.0.conv.weight'].sourceDtype = 'float32',
  m => m.tensors['expected.coordinates'].dtype = 'float32', m => m.outputRows = 0,
  m => m.tensors['expected.features'].byteLength -= 4, m => m.tensors.sample.file = '../sample',
  m => m.subdivisionRows[0][0] = 2]) {
  const changed = structuredClone(manifest);mutate(changed);assert.throws(() => validateSLatDecoderFixture(changed));
}
const a = new Float32Array([.1, -.1, 0]), b = new Float32Array([.1001, -.1, -.00001]);
assert.equal(compareLearnedSubdivision(a, b).signFailures, 0);
assert.equal(compareLearnedSubdivision(new Float32Array([.1, -.1, .00001]), b).signFailures, 1);
assert.throws(() => compareLearnedSubdivision(new Float32Array(), new Float32Array()), /empty/);
assert.equal(compareHalfRoundTrip(new Float32Array([0, -0, Infinity, NaN]), new Float32Array([0, -0, Infinity, NaN])).passed, true);
assert.equal(compareHalfRoundTrip(new Float32Array([0]), new Float32Array([-0])).passed, false);
console.log('Learned decoder admission rejects source/route/precision/count/partial-evidence substitution; exact subdivision signs and half bits are load-bearing. Metadata is not live conformance.');
