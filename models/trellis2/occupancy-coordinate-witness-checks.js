import { buildOccupancyCoordinatesPlan } from './occupancy-coordinates.js';
export function validateOccupancyCoordinateFixture(m) {
  if (m?.schema !== 'trellis2.occupancy-coordinate-reference.v0' || m.status !== 'succeeded' ||
      m.referenceRoute !== 'numpy-cpu-source-occupancy-coordinate-policy' || m.modelCalls !== 0 ||
      m.threshold !== 0 || m.coordinateOrder !== 'z-y-x-lexicographic') throw Error('observed source coordinate policy required');
  for (const name of ['source', 'producer']) if (!/^[a-f0-9]{40}$/.test(m[name]?.commit) || m[name].dirty !== '') throw Error('clean coordinate source/producer required');
  for (const hash of [m.source['generate.py'], m.input?.decoderManifestSha256, m.input?.logitsSha256]) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('coordinate source/input identity required');
  }
  const plan = buildOccupancyCoordinatesPlan(m.config);
  if (!Number.isSafeInteger(m.rows) || m.rows < 1 || m.rows > plan.candidateRows) throw Error('complete nonempty occupied rows required');
  for (const [name, shape, dtype] of [['logits', plan.inputShape, 'float32'], ['expected.coordinates', [m.rows, 3], 'int32'], ['expected.flags', [plan.candidateRows], 'uint32']]) {
    const row = m.tensors?.[name];
    if (!row || JSON.stringify(row.shape) !== JSON.stringify(shape) || row.dtype !== dtype ||
        row.byteLength !== shape.reduce((a, b) => a * b, 4) || !/^[a-f0-9]{64}$/.test(row.sha256) || !/^[\w.-]+$/.test(row.file)) throw Error('partial/wrong coordinate tensor ' + name);
  }
  if (m.tensors.logits.sha256 !== m.input.logitsSha256) throw Error('logit input identity mismatch');
  return plan;
}
export function compareOccupancyCoordinates(actual, expected) {
  if (!(actual instanceof Int32Array) || !(expected instanceof Int32Array)) throw TypeError('Int32 coordinate arrays required');
  if (!actual.length || actual.length !== expected.length || actual.length % 3) return { passed: false, count: actual.length, failures: null, reason: 'blank/partial coordinates' };
  let failures = 0; for (let i = 0; i < actual.length; i++) failures += actual[i] !== expected[i];
  return { passed: failures === 0, count: actual.length, failures, tolerance: 'exact-coordinate-and-row-identity' };
}
