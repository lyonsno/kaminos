import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY,
  BOUNDARY_SPLAT_FEATURE_ORDER,
  BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS,
  decodeBoundarySplatFeatureCapture,
  packBoundarySplatFeatureCapture,
} from '../boundary-splat-feature-capture.mjs';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

assert.equal(BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY, 'boundary-splat-selected-candidate-features-v0');
assert.equal(BOUNDARY_SPLAT_FEATURE_STRIDE_FLOATS, 16);
assert.deepEqual(BOUNDARY_SPLAT_FEATURE_ORDER, [
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

const values = new Float32Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
]);
const capture = decodeBoundarySplatFeatureCapture(values, 2, 131072);
assert.equal(capture.identity, BOUNDARY_SPLAT_FEATURE_CAPTURE_IDENTITY);
assert.equal(capture.rowCount, 2);
assert.equal(capture.strideFloats, 16);
assert.deepEqual(capture.rows[1], Array.from(values.slice(16, 32)));
assert.deepEqual(capture.statistics[0], { feature: 'sidecar.support', min: 0, max: 16, mean: 8 });
assert.deepEqual(capture.statistics[15], { feature: 'micro.w', min: 15, max: 31, mean: 23 });
const packed = packBoundarySplatFeatureCapture(values, 2, 131072);
assert.equal(packed.rows, undefined);
assert.equal(packed.packedByteLength, values.byteLength);
const packedBytes = Buffer.from(packed.packedFloat32Base64, 'base64');
assert.deepEqual(new Float32Array(packedBytes.buffer, packedBytes.byteOffset, values.length), values);

assert.throws(() => decodeBoundarySplatFeatureCapture(new Float32Array(16), 0, 131072), /positive integer/);
assert.throws(() => decodeBoundarySplatFeatureCapture(new Float32Array(15), 1, 131072), /exactly 16/);
assert.throws(() => decodeBoundarySplatFeatureCapture(new Float32Array(32), 2, 1), /exceeds capacity/);
const nonFinite = new Float32Array(16);
nonFinite[7] = Number.NaN;
assert.throws(() => decodeBoundarySplatFeatureCapture(nonFinite, 1, 131072), /non-finite/);

assert.match(page, /volume_boundary_splat_feature_capture/, 'URL route declares selected-candidate feature capture');
assert.match(core, /boundarySplatFeatureCaptureRequested/, 'runtime distinguishes requested feature capture');
assert.match(core, /boundarySplatFeatureCaptureEffective/, 'runtime reports effective feature capture');
assert.match(core, /boundarySplatFeatureBuffer/, 'runtime owns a dedicated feature buffer');
assert.match(core, /boundarySplatFeatureRows\[candidateIndex\]/, 'compaction writes exact selected-candidate rows at the accepted candidate slot');
assert.match(core, /sampleBoundarySplatFeatureCapture\(boundarySplatSample\.instanceCount\)/, 'witness readback uses the exact accepted instance count without a hidden row cap');
assert.match(witness, /const boundarySplatFeatureCapture\s*=\s*sample\.boundarySplatFeatureCaptureRequested[\s\S]*materializeBoundarySplatFeatureCapture/, 'witness materializes the full requested feature capture object');
assert.match(witness, /--boundary-splat-feature-out/, 'witness exposes a direct feature artifact output path');
assert.match(witness, /packedFloat32Base64[\s\S]*writeFileSync/, 'witness materializes every packed feature row without terminal transcription');

console.log('boundary splat feature capture contracts passed');
