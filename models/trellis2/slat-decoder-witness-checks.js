import { buildSLatDecoderPlan, slatDecoderWeightShapes } from './slat-decoder.js';
import { compareDecoderTensor } from './sparse-decoder-witness-checks.js';
export const SLAT_DECODER_REFERENCE_ROUTE = 'pinned-MLX-GPU-source-SLat-decoder/native-FP16-torso-F32-endpoints';
const sha = v => /^[a-f0-9]{64}$/.test(v ?? '');
export function slatDecoderObservationShapes(manifest) {
  const p = buildSLatDecoderPlan(manifest.config);
  return { features: [manifest.outputRows, p.outChannels], coordinates: [manifest.outputRows, 3], halfRoundTrip: [65536],
    ...Object.fromEntries(manifest.subdivisionRows.map((shape, i) => ['subdivision' + i, shape])) };
}
export function validateSLatDecoderFixture(m) {
  if (m?.schema !== 'trellis2.slat-decoder-reference.v0' || m.status !== 'succeeded' || m.referenceRoute !== SLAT_DECODER_REFERENCE_ROUTE) throw Error('complete actual source learned-decoder reference required');
  for (const name of ['source', 'producer']) if (!/^[a-f0-9]{40}$/.test(m[name]?.commit ?? '') || m[name].dirty !== '' ||
    m[name + 'After']?.commit !== m[name].commit || m[name + 'After'].dirty !== '') throw Error('clean unchanged source/producer required');
  const plan = buildSLatDecoderPlan(m.config), shapes = slatDecoderWeightShapes(plan), b = m.effectiveBackend, r = b?.route;
  if (!['synthetic-operation-conformance', 'checkpoint-decoder'].includes(m.fixtureKind)) throw Error('explicit learned-decoder input class required');
  if (m.fixtureKind === 'checkpoint-decoder') {
    if (JSON.stringify(plan.channels) !== '[1024,512,256,128,64]' || JSON.stringify(plan.numBlocks) !== '[4,16,8,4,0]' ||
      plan.latentChannels !== 32 || !sha(m.checkpoint?.sha256) || !sha(m.checkpointConfig?.sha256) || !sha(m.input?.sha256)) throw Error('complete checkpoint geometry/provenance required');
    if (plan.mode === 'texture' && !sha(m.guide?.sha256)) throw Error('matching source shape guide provenance required');
  } else if (plan.mode !== 'shape' || plan.tokenRows !== 3 || plan.resolution !== 2 || plan.latentChannels !== 2 ||
    JSON.stringify(plan.channels) !== '[16,8]' || JSON.stringify(plan.numBlocks) !== '[1,0]') throw Error('synthetic fixture must retain its actual source operation comparison class');
  if (m.modelCalls !== 1 || m.convolutionsExecuted !== plan.numBlocks.reduce((a, b) => a + b, 0) + 2 * plan.subdivisionLevels ||
    m.parameterCount !== Object.values(shapes).reduce((n, s) => n + s.reduce((a, b) => a * b, 1), 0) ||
    b?.device !== 'Device(gpu, 0)' || b.arithmetic !== plan.arithmetic || b.weightLayout !== plan.weightLayout ||
    b.normEpsilon !== 1e-6 || b.terminalNormEpsilon !== 1e-5 || b.sourceModel !== 'actual SLatDecoder.__call__' ||
    r?.decoder_linear_backend !== 'native' || r.sparse_conv_matmul_backend !== 'native' ||
    r.decoder_silu?.backend !== 'mlx-native' || r.decoder_layernorm?.backend !== 'mlx-fast-layer-norm') throw Error('actual complete native FP16-source decoder graph required');
  if (!Number.isSafeInteger(m.outputRows) || m.outputRows < 1 || m.outputResolution !== plan.outputResolution ||
    !Array.isArray(m.subdivisionRows) || m.subdivisionRows.length !== plan.subdivisionLevels) throw Error('complete learned output/counts required');
  let rows = plan.tokenRows;
  for (const [i, shape] of m.subdivisionRows.entries()) {
    if (JSON.stringify(shape) !== JSON.stringify([rows, 8])) throw Error('matching learned subdivision parent rows required');
    const next = i + 1 < m.subdivisionRows.length ? m.subdivisionRows[i + 1]?.[0] : m.outputRows;
    if (!Number.isSafeInteger(next) || next < 1 || next > rows * 8) throw Error('complete source subdivision capacity required');rows = next;
  }
  const descriptors = { sample: [plan.tokenRows, plan.latentChannels], coordinates: [plan.tokenRows, 3], silu: [65536], halfInputs: [65536],
    ...Object.fromEntries(Object.entries(shapes).map(([name, shape]) => ['weight.' + name, shape])),
    ...Object.fromEntries(Object.entries(slatDecoderObservationShapes(m)).filter(([name]) => name !== 'halfRoundTrip').map(([name, shape]) => ['expected.' + name, shape])) };
  if (plan.mode === 'texture') for (let i = 0; i < plan.subdivisionLevels; i++) descriptors['guide' + i] = m.subdivisionRows[i];
  for (const [name, shape] of Object.entries(descriptors)) {
    const row = m.tensors?.[name], integer = name === 'coordinates' || name === 'expected.coordinates',
      half = name === 'silu' || name.startsWith('weight.blocks.') || name.startsWith('expected.subdivision');
    if (!row || JSON.stringify(row.shape) !== JSON.stringify(shape) || row.dtype !== (integer ? 'int32' : 'float32') ||
      row.sourceDtype !== (integer ? 'int32' : half ? 'float16' : 'float32') || row.byteLength !== shape.reduce((a, b) => a * b, 4) ||
      !sha(row.sha256) || !/^[\w.-]+$/.test(row.file)) throw Error('partial/wrong source learned decoder tensor ' + name);
  }
  return plan;
}
export function compareLearnedSubdivision(actual, expected) {
  const comparison = compareDecoderTensor(actual, expected);let signFailures = 0;
  if (actual instanceof Float32Array && expected instanceof Float32Array && actual.length === expected.length) {
    for (let i = 0; i < actual.length; i++) if ((actual[i] > 0) !== (expected[i] > 0)) signFailures++;
  } else signFailures = Math.max(actual?.length ?? 1, expected?.length ?? 1, 1);
  return { ...comparison, signFailures, passed: comparison.passed && signFailures === 0 };
}
export function compareHalfRoundTrip(actual, expected) {
  if (!(actual instanceof Float32Array) || !(expected instanceof Float32Array) || !actual.length || actual.length !== expected.length) return { passed: false, error: 'complete half round-trip observation required' };
  const a = new Uint32Array(actual.buffer, actual.byteOffset, actual.length), b = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);let failures = 0;
  for (let i = 0; i < actual.length; i++) if (!(Number.isNaN(actual[i]) && Number.isNaN(expected[i])) && a[i] !== b[i]) failures++;
  return { passed: failures === 0, failures, count: actual.length, contract: 'exact finite/infinity/zero bits; NaN class, not payload' };
}
