import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { buildGrid96CameraTeacherComponents } from '../volume-grid96-camera-teacher-normalizer.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'grid96-camera-teacher-contract-'));
const angles = Array.from({ length: 21 }, (_, index) => Number((-0.42 + index * 0.042).toFixed(3)));
const sourceSha256 = '1'.repeat(64);
const supportSha256 = '2'.repeat(64);
const coefficientSha256 = '3'.repeat(64);
const fluidSha256 = '4'.repeat(64);
const frontSha256 = '5'.repeat(64);
const controlsHash = '6'.repeat(64);
const controlIdentity = 'sha256:exact-grid96-controls';
const sourceRoute = {
  requested: 'http://127.0.0.1:19096/?volume_resolution=96',
  effective: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  fallbackReason: null,
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function writePng(index) {
  const width = 314;
  const height = 242;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const rows = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) rows.fill(index + 1, row * (width + 1) + 1, (row + 1) * (width + 1));
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const path = join(scratch, `camera-${String(index).padStart(2, '0')}-shared-transport-target.png`);
  writeFileSync(path, bytes);
  return path;
}

function capture(index) {
  const imagePath = writePng(index);
  return {
    cameraIndex: index,
    cameraAngle: angles[index],
    mode: 'sharedTransmittanceContributionSum',
    requestedRaySteps: 160,
    effectiveRaySteps: 160,
    sameStateCaptureId: 'filament-orbit-f120-s120',
    frameCount: 120,
    simStepCount: 120,
    cameraPose: {
      position: [1 + index * 0.01, 0.28, 2 - index * 0.01],
      target: [0, 0.02, 0],
    },
    cameraPoseHash: sha256(Buffer.from(`camera-${index}`)),
    pixelHash: sha256(readFileSync(imagePath)),
    width: 314,
    height: 242,
    metrics: { nonblank: true, litPixels: 100 + index },
    requestedRoute: '/volume-selective-head-live.html',
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'WebGPU:apple',
    imagePath,
  };
}

function fixtures() {
  const captures = angles.map((_, index) => capture(index));
  const source = {
    status: 'complete', failurePhase: null, role: 'source', grid: 96,
    sameStateCaptureId: 'exact-full-flame-grid96-state120-v0', simStepCount: 120,
    requestedControlIdentity: controlIdentity, effectiveControlIdentity: controlIdentity,
    route: sourceRoute,
    sidecars: { fluid: { sha256: fluidSha256 }, front: { sha256: frontSha256 } },
  };
  const support = {
    status: 'complete', failurePhase: null, role: 'support', grid: 96,
    sameStateCaptureId: source.sameStateCaptureId, simStepCount: 120,
    requestedControlIdentity: controlIdentity, effectiveControlIdentity: controlIdentity,
    route: sourceRoute, sourceManifestSha256: sourceSha256,
    nativeCellIndexSha256: supportSha256, rowCount: 370194, sampleCap: null,
    droppedRowCount: 0, overflowCount: 0,
  };
  const coefficients = {
    status: 'complete', failurePhase: null, role: 'coefficients', grid: 96,
    sameStateCaptureId: source.sameStateCaptureId, simStepCount: 120,
    requestedControlIdentity: controlIdentity, effectiveControlIdentity: controlIdentity,
    route: sourceRoute, sourceManifestSha256: sourceSha256,
    nativeCellIndexSha256: supportSha256, rowCount: 370194,
    artifact: { sha256: coefficientSha256 },
  };
  const orbit = {
    schema: 'kaminos.volume.raymarch-filament-orbit-witness.v0', status: 'complete', failurePhase: null,
    effectiveRendererRoute: 'native-3d-compute-fluid-raymarch-v0',
    captureConfig: {
      orbitAngles: angles, rayStepCounts: [48, 96, 160], simulatorAdvance: false, smoke: 'off',
      expectedFrameCount: 120, expectedSimStepCount: 120, expectedControlsHash: controlsHash,
      expectedWarmupAuthority: 'imported-field-checksum-anchor-v0', expectedWarmupTarget: 120,
      expectedAnchorFluidSha256: fluidSha256, expectedAnchorFrontSha256: frontSha256,
    },
    frozenState: {
      sameStateCaptureId: 'filament-orbit-f120-s120', baseFrameCount: 120,
      baseSimStepCount: 120, controlsHash,
    },
    importedFieldReceipt: {
      effective: { grid: 96, fluidSha256, frontSha256, backend: 'WebGPU:apple', effectiveRoute: 'native-3d-compute-fluid-raymarch-v0' },
    },
    captures,
  };
  const oracle = {
    schema: 'kaminos.volume.layer-coefficient-render-oracle.v0', status: 'complete', failurePhase: null,
    requested: { stateStep: 120, sampleCap: null, depthBins: 96 },
    effective: {
      stateStep: 120, rowCount: 370194, sampleCap: null, droppedRowCount: 0,
      coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
      sharedTransmittanceIdentity: 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0',
      orderApproximation: 'camera-depth-96-bin-one-running-transmittance-v0',
      coefficientSourceAuthority: 'exact-local-layer-emission-extinction-v0',
    },
    frozenStateBinding: { sameStateCaptureId: orbit.frozenState.sameStateCaptureId, controlsHash, fluidSha256, frontSha256, hashMatch: true },
    descriptorReceipt: { indexSha256: supportSha256 },
    metrics: { cameras: angles.map((cameraAngle, cameraIndex) => ({ cameraIndex, cameraAngle, split: cameraIndex === 10 ? 'calibration' : 'heldOut' })) },
    artifacts: { cameraCount: 21 },
  };
  return { source, support, coefficients, orbit, oracle };
}

const valid = fixtures();
const built = buildGrid96CameraTeacherComponents({ ...valid, sourceManifestSha256: sourceSha256 });
assert.equal(built.cameras.cameras.length, 21);
assert.equal(built.teacher.targets.length, 21);
assert.equal(built.teacher.executionRoute.backend, 'python-numpy-cpu-v0');
assert.equal(built.teacher.targets[10].split, 'calibration');
assert.equal(built.teacher.targets[0].artifact.semanticRole, 'exact-shared-transmittance-target');

const omittedCompletionPhase = fixtures();
delete omittedCompletionPhase.orbit.failurePhase;
assert.doesNotThrow(() => buildGrid96CameraTeacherComponents({
  ...omittedCompletionPhase,
  sourceManifestSha256: sourceSha256,
}), 'a complete orbit may omit its null failure phase');

for (const [label, mutate, pattern] of [
  ['partial camera cohort', value => value.orbit.captures.pop(), /partial|21-camera/],
  ['cached camera pose', value => { value.orbit.captures[1].cameraPoseHash = value.orbit.captures[0].cameraPoseHash; }, /cached|duplicated/],
  ['wrong state', value => { value.orbit.frozenState.baseSimStepCount = 119; }, /state|step/],
  ['wrong source hash', value => { value.orbit.captureConfig.expectedAnchorFluidSha256 = '9'.repeat(64); }, /fluid|source/],
  ['hidden sample cap', value => { value.oracle.effective.sampleCap = 1000; }, /sampleCap|cap/],
  ['dropped rows', value => { value.oracle.effective.droppedRowCount = 1; }, /dropped/],
  ['oracle support drift', value => { value.oracle.descriptorReceipt.indexSha256 = '8'.repeat(64); }, /support|index/],
  ['blank target', value => { writeFileSync(value.orbit.captures[0].imagePath, Buffer.alloc(0)); }, /blank|PNG|target/],
]) {
  const value = fixtures();
  mutate(value);
  assert.throws(() => buildGrid96CameraTeacherComponents({ ...value, sourceManifestSha256: sourceSha256 }), pattern, label);
}

rmSync(scratch, { recursive: true, force: true });
console.log('volume-grid96-camera-teacher-normalizer contracts: ok');
