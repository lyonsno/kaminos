import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exportModuleUrl = new URL('../smoke-oracle-teacher-export.mjs', import.meta.url);
const exportModuleSource = await readFile(exportModuleUrl, 'utf8').catch(() => '');
const volumeCoreSource = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  exportModuleSource,
  /export async function materializeSmokeOracleTeacherFrameExport/,
  'teacher export must materialize chunked browser readback into durable sidecars',
);
assert.match(
  volumeCoreSource,
  /sampleFullGridFluidFieldChunk/,
  'volume runtime must expose an explicit chunked full-grid fluid export, not a giant JSON field',
);
assert.doesNotMatch(
  volumeCoreSource,
  /packedFloat32Base64[^]*fluidBufferBytes\(gridSize\)/,
  'full-grid export must not return the entire fluid buffer as one base64 payload',
);

const {
  FULL_GRID_FIELD_EXPORT_IDENTITY,
  VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER,
  materializeSmokeOracleTeacherFrameExport,
} = await import(exportModuleUrl);

assert.equal(FULL_GRID_FIELD_EXPORT_IDENTITY, 'full-grid-fluid-front-boundary-sidecars-v0');
assert.equal(VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER.length, 16);
assert.deepEqual(VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER.slice(0, 5), [
  'velocityX',
  'velocityY',
  'velocityZ',
  'densityCarrier',
  'smokeDensity',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const floats = new Float32Array(VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER.length * 8);
for (let index = 0; index < floats.length; index += 1) floats[index] = index / 100;
const bytes = Buffer.from(floats.buffer);
const firstChunk = bytes.subarray(0, 192);
const secondChunk = bytes.subarray(192);
const metadata = {
  identity: 'full-grid-fluid-field-chunked-readback-v0',
  exportIdentity: FULL_GRID_FIELD_EXPORT_IDENTITY,
  status: 'captured',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  prototypeIdentity: 'kaminos-volume-prototype-v0',
  backend: 'WebGPU:apple',
  sampleAuthority: 'render-only-frozen-sim-state',
  grid: 2,
  totalByteLength: bytes.byteLength,
  floatCount: floats.length,
  channelOrder: VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER,
  deterministicReplay: {
    identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
    authority: 'same-route-controls-fixed-step-replay',
    completedSteps: 96,
    simStepCount: 96,
    controlsSignature: 'fixture-controls-v0',
    grid: 2,
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
  },
  worldSpace: {
    coordinateFrame: 'kaminos-volume-world-v0',
    transformAuthority: 'native-volume-grid-world-transform-v0',
    bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
  },
  camera: {
    identity: 'checksum-bound-native-camera-matrices-v0',
    position: [-4.24, 2.14, 8.18],
    target: [0, 0.02, 0],
    projectionMatrix: Array.from({ length: 16 }, (_, index) => index + 0.25),
    matrixWorldInverse: Array.from({ length: 16 }, (_, index) => index + 10.25),
  },
};
const chunks = [
  {
    offsetBytes: 0,
    byteLength: firstChunk.byteLength,
    packedBase64: firstChunk.toString('base64'),
  },
  {
    offsetBytes: firstChunk.byteLength,
    byteLength: secondChunk.byteLength,
    packedBase64: secondChunk.toString('base64'),
  },
];

const directory = await mkdtemp(join(tmpdir(), 'kaminos-oracle-teacher-export-'));
try {
  const manifest = await materializeSmokeOracleTeacherFrameExport({
    outDir: directory,
    frameId: 'sim-step-96',
    metadata,
    chunks,
  });
  assert.equal(existsSync(manifest.manifestPath), true, 'manifest must be written to disk');
  assert.equal(existsSync(join(directory, 'sim-step-96.fluid.f32')), true, 'fluid sidecar must be written to disk');
  const writtenManifest = JSON.parse(await readFile(manifest.manifestPath, 'utf8'));
  assert.equal(writtenManifest.schema, 'kaminos.volume.full-grid-field-export.v0');
  assert.equal(writtenManifest.identity, FULL_GRID_FIELD_EXPORT_IDENTITY);
  assert.equal(writtenManifest.completeFieldCoverage, true);
  assert.equal(writtenManifest.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(writtenManifest.prototypeIdentity, 'kaminos-volume-prototype-v0');
  assert.equal(writtenManifest.backend, 'WebGPU:apple');
  assert.deepEqual(writtenManifest.fluidChannelOrder, VOLUME_FULL_GRID_FIELD_CHANNEL_ORDER);
  assert.equal(writtenManifest.sidecars.fluid.path, 'sim-step-96.fluid.f32');
  assert.equal(writtenManifest.sidecars.fluid.sha256, sha256(bytes));
  assert.equal(writtenManifest.sidecars.fluid.byteLength, bytes.byteLength);
  assert.deepEqual(writtenManifest.sidecars.fluid.shape, [2, 2, 2, 16]);
  assert.equal(writtenManifest.deterministicReplay.simStepCount, 96);
  assert.deepEqual(writtenManifest.camera, metadata.camera, 'dense teacher manifest must preserve checksum-bound camera matrices');
  assert.deepEqual(Buffer.from(await readFile(join(directory, 'sim-step-96.fluid.f32'))), bytes);

  await assert.rejects(
    () => materializeSmokeOracleTeacherFrameExport({
      outDir: directory,
      frameId: 'wrong-route',
      metadata: { ...metadata, effectiveRoute: 'cached-demo-route-v0' },
      chunks,
    }),
    /effective route/i,
    'wrong or fallback teacher routes must not become dense oracle exports',
  );
  await assert.rejects(
    () => materializeSmokeOracleTeacherFrameExport({
      outDir: directory,
      frameId: 'partial',
      metadata,
      chunks: [chunks[1]],
    }),
    /chunk.*offset|complete/i,
    'partial chunks must fail instead of writing a completeFieldCoverage manifest',
  );
  await assert.rejects(
    () => materializeSmokeOracleTeacherFrameExport({
      outDir: directory,
      frameId: 'changed-length',
      metadata: { ...metadata, totalByteLength: bytes.byteLength + 4 },
      chunks,
    }),
    /byte length/i,
    'hidden truncation or byte-length drift must fail before sidecar publication',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke oracle teacher export contracts passed');
