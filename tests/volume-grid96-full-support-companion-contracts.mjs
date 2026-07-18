import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';

import { GRID96_DESCRIPTOR_ORDER } from '../volume-grid96-full-support-companion.mjs';

const root = resolve(import.meta.dirname, '..');
const producer = join(root, 'volume-grid96-full-support-companion.mjs');
const comparisonPath = join(
  root,
  'artifacts/pyro-gaussian-footprint-kneecapper-0716/expanded-union-footprint-oracle-state120-r1/cockpit-manifest.v0.json',
);
const scratch = mkdtempSync(join(tmpdir(), 'kaminos-grid96-companion-contract-'));
const sameStateCaptureId = 'grid96-full-flame-f120-s120';
const controlIdentity = 'sha256:grid96-exact-controls';
const supportIndexShaPlaceholder = 'a'.repeat(64);
const cameraIndices = Array.from({ length: 21 }, (_, index) => index);
const cameraAngles = cameraIndices.map(index => Number((-0.42 + index * 0.042).toFixed(3)));
const heldOutCameraIndices = cameraIndices.filter(index => index !== 10);
const targetWidth = 314;
const targetHeight = 242;
const route = {
  requested: 'http://127.0.0.1:19096/volume-selective-head-live.html?volume_resolution=96&role=truthHigh',
  effective: 'native-3d-compute-fluid-raymarch-v0',
  backend: 'WebGPU:apple',
  fallbackReason: null,
};
const executionRoute = {
  requested: 'python volume-layer-coefficient-render-oracle.py --state-step 120 --depth-bins 96 --sample-cap none',
  effective: 'python volume-layer-coefficient-render-oracle.py --state-step 120 --depth-bins 96 --sample-cap none',
  requestedDepthBins: 96,
  effectiveDepthBins: 96,
  backend: 'python-numpy-cpu-v0',
  fallbackUsed: false,
  failurePhase: null,
  sampleCap: null,
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeJson(name, value) {
  const path = join(scratch, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function writeArtifact(name, byteLength, metadata, fill = 0) {
  const path = join(scratch, name);
  const bytes = Buffer.alloc(byteLength, fill);
  writeFileSync(path, bytes);
  return {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    ...metadata,
  };
}

function writeUint32Artifact(name, values, metadata) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes), ...metadata };
}

function writeFloat32Artifact(name, values, metadata) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes), ...metadata };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function writePngArtifact(name, width, height, fill, metadata = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const scanlines = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) scanlines.fill(fill, row * (width + 1) + 1, (row + 1) * (width + 1));
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes), ...metadata };
}

function component(role, details = {}) {
  const producerReceipt = ['support', 'descriptors', 'coefficients'].includes(role) ? {
    authority: 'exact-grid96-source-support-coefficient-descriptor-capture-v0',
    coefficientRenderAuthority: {
      requestedComposition: 'raymarch-only-v0',
      effectiveComposition: 'raymarch-only-v0',
      compositionAuthority: 'diagnostic-raymarch-full-selected-field-authority-v0',
      compositionFallbackReason: null,
    },
  } : undefined;
  return {
    schema: `kaminos.volume.grid96-${role}.v0`,
    status: 'complete',
    failurePhase: null,
    role,
    grid: 96,
    sameStateCaptureId,
    simStepCount: 120,
    requestedControlIdentity: controlIdentity,
    effectiveControlIdentity: controlIdentity,
    route,
    ...(producerReceipt ? { producerReceipt } : {}),
    ...details,
  };
}

const sourcePath = writeJson('source.json', component('source', {
  authority: 'native-grid96-full-field-export-v0',
  resizedGrid160Evidence: false,
  completeFieldCoverage: true,
  fullGridCellCount: 96 ** 3,
  sidecars: {
    fluid: writeArtifact('source-fluid.f32', 96 ** 3 * 16 * 4, {
      dtype: 'float32-le',
      shape: [96, 96, 96, 16],
      semanticRole: 'full-field-fluid',
      channelOrder: [
        'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
        'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
      ],
    }),
    front: writeArtifact('source-front.f32', 96 ** 3 * 4, {
      dtype: 'float32-le', shape: [96, 96, 96, 1], semanticRole: 'full-field-front', channelOrder: ['frontTopology'],
    }),
    boundary: writeArtifact('source-boundary.f32', 96 ** 3 * 4 * 4, {
      dtype: 'float32-le', shape: [96, 96, 96, 4], semanticRole: 'full-field-boundary', channelOrder: ['support', 'coverage', 'ridge', 'footprint'],
    }),
    majorant: writeArtifact('source-majorant.f32', 24 ** 3 * 4 * 4, {
      dtype: 'float32-le', shape: [24, 24, 24, 4], semanticRole: 'full-field-majorant', channelOrder: ['density', 'fire', 'extinction', 'importance'],
    }),
  },
}));
const sourceManifestSha256 = sha256(readFileSync(sourcePath));
const rowCount = 3;
const nativeCellIndices = writeUint32Artifact('support-indices.u32', [1, 2, 3], {
  dtype: 'uint32-le', shape: [rowCount], semanticRole: 'analytical-admission-native-cell-indices',
});
const supportIndexSha = nativeCellIndices.sha256;
assert.notEqual(supportIndexSha, supportIndexShaPlaceholder);

const supportPath = writeJson('support.json', component('support', {
  sourceManifestSha256,
  identity: 'full-flame-ridge-nonridge-live-union-v0',
  admissionIdentity: 'explicit-ridge-union-promoted-nonridge-source-selector-v0',
  admissionAuthority: 'external-native-cell-index-list-v0',
  nativeCellIndexSha256: supportIndexSha,
  rowCount,
  sampleCap: null,
  droppedRowCount: 0,
  overflowCount: 0,
  duplicatePolicy: 'forbidden',
  nativeCellIndices,
  admission: writeArtifact('support-admission.f32', rowCount * 2 * 4, {
    dtype: 'float32-le', shape: [rowCount, 2], semanticRole: 'analytical-ridge-or-nonridge-admission',
  }, 2),
  features: writeArtifact('support-features.f32', rowCount * 24 * 4, {
    dtype: 'float32-le', shape: [rowCount, 24], semanticRole: 'post-admission-local-features',
  }, 3),
}));

const descriptorsPath = writeJson('descriptors.json', component('descriptors', {
  sourceManifestSha256,
  identity: 'flow-kernel-local-descriptor-socket-v0',
  kernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
  candidateAdmissionAuthority: 'external-native-cell-index-list-v0',
  nativeCellIndexSha256: supportIndexSha,
  rowCount,
  strideFloats: 100,
  descriptorOrder: GRID96_DESCRIPTOR_ORDER,
  artifact: writeArtifact('descriptors.f32', rowCount * 100 * 4, {
    dtype: 'float32-le', shape: [rowCount, 100], semanticRole: 'camera-independent-flow-kernel-descriptors',
  }, 4),
}));

const coefficientsPath = writeJson('coefficients.json', component('coefficients', {
  sourceManifestSha256,
  identity: 'exact-local-layer-emission-extinction-v0',
  coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
  partitionIdentity: 'separate-nonnegative-ridge-and-nonridge-local-coefficients-v0',
  channels: [
    'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
    'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
  ],
  nonnegative: true,
  nativeCellIndexSha256: supportIndexSha,
  rowCount,
  artifact: writeArtifact('coefficients.f32', rowCount * 8 * 4, {
    dtype: 'float32-le', shape: [rowCount, 8], semanticRole: 'exact-local-layer-emission-extinction',
  }, 5),
}));
const coefficientArtifactSha256 = JSON.parse(readFileSync(coefficientsPath, 'utf8')).artifact.sha256;

const cameras = cameraIndices.map(index => ({
  id: `camera-${String(index).padStart(2, '0')}`,
  index,
  angle: cameraAngles[index],
  split: index === 10 ? 'calibration' : 'heldout',
  pose: { position: [index, 1, 2], target: [0, 0, 0] },
}));
const camerasPath = writeJson('cameras.json', component('camera-cohort', {
  sourceManifestSha256,
  identity: 'filament-orbit-21-camera-yaw-v0',
  indices: cameraIndices,
  angles: cameraAngles,
  calibrationCameraIndex: 10,
  heldOutCameraIndices,
  cameras,
}));

const teacherTargets = cameras.map(camera => ({
  cameraId: camera.id,
  cameraIndex: camera.index,
  split: camera.split,
  sameStateCaptureId,
  simStepCount: 120,
  sourceManifestSha256,
  supportNativeCellIndexSha256: supportIndexSha,
  coefficientArtifactSha256,
  width: targetWidth,
  height: targetHeight,
  artifact: writePngArtifact(
    `teacher-${camera.id}.png`,
    targetWidth,
    targetHeight,
    camera.index + 1,
    { semanticRole: 'exact-shared-transmittance-target' },
  ),
}));
const teacherPath = writeJson('teacher.json', component('teacher', {
  sourceManifestSha256,
  sourceRoute: route,
  executionRoute,
  identity: 'exact-same-state-shared-transmittance-intrinsic-target-v0',
  coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
  transportIdentity: 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0',
  compositionIdentity: 'one-globally-ordered-stream-v0',
  rendererIdentity: 'offline-exact-coefficient-shared-transmittance-oracle-v0',
  cameraCohortIdentity: 'filament-orbit-21-camera-yaw-v0',
  cameraCount: 21,
  calibrationCameraIndex: 10,
  heldOutCameraIndices,
  targetCount: 21,
  targetWidth,
  targetHeight,
  supportNativeCellIndexSha256: supportIndexSha,
  coefficientArtifactSha256,
  targets: teacherTargets,
}));

function run(overrides = {}) {
  const out = overrides.out || join(scratch, `companion-${Math.random().toString(16).slice(2)}.json`);
  const report = overrides.report || join(scratch, `report-${Math.random().toString(16).slice(2)}.json`);
  const args = [
    producer,
    '--source-manifest', overrides.source || sourcePath,
    '--support-manifest', overrides.support || supportPath,
    '--descriptor-manifest', overrides.descriptors || descriptorsPath,
    '--coefficient-manifest', overrides.coefficients || coefficientsPath,
    '--camera-manifest', overrides.cameras || camerasPath,
    '--teacher-manifest', overrides.teacher || teacherPath,
    '--grid160-comparison-manifest', overrides.comparison || comparisonPath,
    '--out', out,
    '--report', report,
  ];
  return { out, report, result: spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' }) };
}

function writeCoupledSupportVariant(prefix, nativeCellIndexArtifact) {
  const support = JSON.parse(readFileSync(supportPath, 'utf8'));
  support.nativeCellIndices = nativeCellIndexArtifact;
  support.nativeCellIndexSha256 = nativeCellIndexArtifact.sha256;
  const descriptors = JSON.parse(readFileSync(descriptorsPath, 'utf8'));
  descriptors.nativeCellIndexSha256 = nativeCellIndexArtifact.sha256;
  const coefficients = JSON.parse(readFileSync(coefficientsPath, 'utf8'));
  coefficients.nativeCellIndexSha256 = nativeCellIndexArtifact.sha256;
  return {
    support: writeJson(`${prefix}-support.json`, support),
    descriptors: writeJson(`${prefix}-descriptors.json`, descriptors),
    coefficients: writeJson(`${prefix}-coefficients.json`, coefficients),
  };
}

const success = run();
assert.equal(success.result.status, 0, success.result.stderr);
const manifest = JSON.parse(readFileSync(success.out, 'utf8'));
assert.equal(manifest.schema, 'kaminos.volume.grid96-full-support-companion.v0');
assert.equal(manifest.status, 'complete');
assert.equal(manifest.failurePhase, null);
assert.equal(manifest.causalQuestion, 'source-lattice-subcell-vs-deposit-space-quadrature-v0');
assert.equal(manifest.grid, 96);
assert.equal(manifest.nativeCellCount, 96 ** 3);
assert.equal(manifest.sourceManifestSha256, sourceManifestSha256);
assert.equal(manifest.support.rowCount, rowCount);
assert.equal(manifest.support.sampleCap, null);
assert.equal(manifest.cameraCohort.calibrationCameraIndex, 10);
assert.equal(manifest.cameraCohort.heldOutCameraIndices.length, 20);
assert.equal(manifest.teacher.transportIdentity, 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0');
assert.equal(manifest.teacher.executionRoute.backend, 'python-numpy-cpu-v0');
assert.equal(manifest.teacher.executionRoute.effectiveDepthBins, 96);
assert.equal(manifest.coefficients.producerReceipt.coefficientRenderAuthority.effectiveComposition, 'raymarch-only-v0');
assert.equal(manifest.teacher.targetWidth, targetWidth);
assert.equal(manifest.teacher.targetHeight, targetHeight);
assert.equal(manifest.teacher.supportNativeCellIndexSha256, supportIndexSha);
assert.equal(manifest.teacher.coefficientArtifactSha256, coefficientArtifactSha256);
assert.equal(manifest.comparison.grid, 160);
assert.equal(manifest.comparison.role, 'immutable-external-comparison-only');

const missingRenderAuthority = JSON.parse(readFileSync(coefficientsPath, 'utf8'));
delete missingRenderAuthority.producerReceipt;
const missingRenderAuthorityResult = run({
  coefficients: writeJson('coefficients-missing-render-authority.json', missingRenderAuthority),
});
assert.notEqual(missingRenderAuthorityResult.result.status, 0);
assert.match(missingRenderAuthorityResult.result.stderr, /render authority|producer receipt|raymarch-only/);

const staleDepthBins = JSON.parse(readFileSync(teacherPath, 'utf8'));
staleDepthBins.executionRoute.effectiveDepthBins = 95;
staleDepthBins.executionRoute.effective = staleDepthBins.executionRoute.effective.replace('--depth-bins 96', '--depth-bins 95');
const staleDepthBinsResult = run({ teacher: writeJson('teacher-stale-depth-bins.json', staleDepthBins) });
assert.notEqual(staleDepthBinsResult.result.status, 0);
assert.match(staleDepthBinsResult.result.stderr, /depth.?bin|effective/);
assert.equal(manifest.claimBoundary.cheaperDemoClaim, false);
assert.equal(manifest.claimBoundary.depositionAdjudication, false);
assert.equal(manifest.claimBoundary.learnerCampaign, false);
assert.equal(Object.hasOwn(manifest, 'model'), false);

const wrongGridSource = writeJson('source-grid160.json', {
  ...JSON.parse(readFileSync(sourcePath, 'utf8')),
  grid: 160,
  fullGridCellCount: 160 ** 3,
  route: { ...route, requested: route.requested.replace('volume_resolution=96', 'volume_resolution=160') },
});
const wrongGrid = run({ source: wrongGridSource });
assert.notEqual(wrongGrid.result.status, 0);
assert.equal(JSON.parse(readFileSync(wrongGrid.report, 'utf8')).failurePhase, 'native-component-validation');

const cappedSupport = writeJson('support-capped.json', { ...JSON.parse(readFileSync(supportPath, 'utf8')), sampleCap: 1 });
const capped = run({ support: cappedSupport, out: success.out });
assert.notEqual(capped.result.status, 0);
assert.match(capped.result.stderr, /sampleCap must be null/);
assert.equal(JSON.parse(readFileSync(success.out, 'utf8')).status, 'failed', 'failed rerun must overwrite stale successful output');

const mismatchedSupport = writeJson('descriptors-wrong-support.json', {
  ...JSON.parse(readFileSync(descriptorsPath, 'utf8')),
  nativeCellIndexSha256: 'd'.repeat(64),
});
const supportDrift = run({ descriptors: mismatchedSupport });
assert.notEqual(supportDrift.result.status, 0);
assert.match(supportDrift.result.stderr, /native-cell support identity/);

const badDescriptorOrder = writeJson('descriptors-wrong-order.json', {
  ...JSON.parse(readFileSync(descriptorsPath, 'utf8')),
  descriptorOrder: [...GRID96_DESCRIPTOR_ORDER].reverse(),
});
const descriptorDrift = run({ descriptors: badDescriptorOrder });
assert.notEqual(descriptorDrift.result.status, 0);
assert.match(descriptorDrift.result.stderr, /descriptor order drifted/);

const resizedSource = writeJson('source-resized.json', {
  ...JSON.parse(readFileSync(sourcePath, 'utf8')),
  authority: 'grid160-resized-to-grid96-v0',
});
const resize = run({ source: resizedSource });
assert.notEqual(resize.result.status, 0);
assert.match(resize.result.stderr, /resize or resample lineage/);

const driftedRoute = writeJson('support-route-drift.json', {
  ...JSON.parse(readFileSync(supportPath, 'utf8')),
  route: { ...route, requested: `${route.requested}&capture=other` },
});
const routeDrift = run({ support: driftedRoute });
assert.notEqual(routeDrift.result.status, 0);
assert.match(routeDrift.result.stderr, /requested source route differs from source/);

const wrongSourceHash = writeJson('coefficients-source-drift.json', {
  ...JSON.parse(readFileSync(coefficientsPath, 'utf8')),
  sourceManifestSha256: 'e'.repeat(64),
});
const sourceDrift = run({ coefficients: wrongSourceHash });
assert.notEqual(sourceDrift.result.status, 0);
assert.match(sourceDrift.result.stderr, /source manifest hash differs from source/);

const badCameras = writeJson('cameras-index-drift.json', {
  ...JSON.parse(readFileSync(camerasPath, 'utf8')),
  cameras: cameras.map((camera, index) => ({ ...camera, index: index === 20 ? 19 : camera.index })),
});
const partialCohort = run({ cameras: badCameras });
assert.notEqual(partialCohort.result.status, 0);
assert.match(partialCohort.result.stderr, /map one-to-one onto the exact orbit/);

const corruptIndices = JSON.parse(readFileSync(supportPath, 'utf8'));
corruptIndices.nativeCellIndices.sha256 = 'f'.repeat(64);
const corruptSupport = run({ support: writeJson('support-corrupt-artifact.json', corruptIndices) });
assert.notEqual(corruptSupport.result.status, 0);
assert.match(corruptSupport.result.stderr, /artifact hash drifted/);

const duplicateIndexArtifact = writeUint32Artifact('support-indices-duplicate.u32', [1, 1, 3], {
  dtype: 'uint32-le', shape: [rowCount], semanticRole: 'analytical-admission-native-cell-indices',
});
const duplicateIndices = run(writeCoupledSupportVariant('duplicate-indices', duplicateIndexArtifact));
assert.notEqual(duplicateIndices.result.status, 0);
assert.match(duplicateIndices.result.stderr, /duplicate native-cell index/);

const outOfRangeIndexArtifact = writeUint32Artifact('support-indices-out-of-range.u32', [1, 2, 96 ** 3], {
  dtype: 'uint32-le', shape: [rowCount], semanticRole: 'analytical-admission-native-cell-indices',
});
const outOfRangeIndices = run(writeCoupledSupportVariant('out-of-range-indices', outOfRangeIndexArtifact));
assert.notEqual(outOfRangeIndices.result.status, 0);
assert.match(outOfRangeIndices.result.stderr, /outside native grid96/);

const invalidAdmissionArtifact = writeFloat32Artifact('support-admission-zero-row.f32', [1, 0, 0, 0, 0, 1], {
  dtype: 'float32-le', shape: [rowCount, 2], semanticRole: 'analytical-ridge-or-nonridge-admission',
});
const invalidAdmissionSupport = JSON.parse(readFileSync(supportPath, 'utf8'));
invalidAdmissionSupport.admission = invalidAdmissionArtifact;
const invalidAdmission = run({ support: writeJson('support-zero-admission-row.json', invalidAdmissionSupport) });
assert.notEqual(invalidAdmission.result.status, 0);
assert.match(invalidAdmission.result.stderr, /admission row 1 has no Ridge or Non-Ridge membership/);

const nanDescriptorArtifact = writeFloat32Artifact(
  'descriptors-nan.f32',
  Array.from({ length: rowCount * GRID96_DESCRIPTOR_ORDER.length }, (_, index) => index === 17 ? Number.NaN : 0),
  { dtype: 'float32-le', shape: [rowCount, 100], semanticRole: 'camera-independent-flow-kernel-descriptors' },
);
const nanDescriptors = JSON.parse(readFileSync(descriptorsPath, 'utf8'));
nanDescriptors.artifact = nanDescriptorArtifact;
const nonfiniteDescriptors = run({ descriptors: writeJson('descriptors-nan.json', nanDescriptors) });
assert.notEqual(nonfiniteDescriptors.result.status, 0);
assert.match(nonfiniteDescriptors.result.stderr, /kernel descriptors contains a non-finite float/);

const negativeCoefficientArtifact = writeFloat32Artifact(
  'coefficients-negative.f32',
  Array.from({ length: rowCount * 8 }, (_, index) => index === 7 ? -0.25 : 0.25),
  { dtype: 'float32-le', shape: [rowCount, 8], semanticRole: 'exact-local-layer-emission-extinction' },
);
const negativeCoefficientsManifest = JSON.parse(readFileSync(coefficientsPath, 'utf8'));
negativeCoefficientsManifest.artifact = negativeCoefficientArtifact;
const negativeCoefficients = run({ coefficients: writeJson('coefficients-negative.json', negativeCoefficientsManifest) });
assert.notEqual(negativeCoefficients.result.status, 0);
assert.match(negativeCoefficients.result.stderr, /exact layer coefficients contains a negative float/);

const zeroCoefficientArtifact = writeFloat32Artifact(
  'coefficients-zero.f32',
  Array.from({ length: rowCount * 8 }, () => 0),
  { dtype: 'float32-le', shape: [rowCount, 8], semanticRole: 'exact-local-layer-emission-extinction' },
);
const zeroCoefficientsManifest = JSON.parse(readFileSync(coefficientsPath, 'utf8'));
zeroCoefficientsManifest.artifact = zeroCoefficientArtifact;
const zeroCoefficientTeacher = JSON.parse(readFileSync(teacherPath, 'utf8'));
zeroCoefficientTeacher.coefficientArtifactSha256 = zeroCoefficientArtifact.sha256;
for (const target of zeroCoefficientTeacher.targets) target.coefficientArtifactSha256 = zeroCoefficientArtifact.sha256;
const zeroCoefficients = run({
  coefficients: writeJson('coefficients-zero.json', zeroCoefficientsManifest),
  teacher: writeJson('teacher-zero-coefficients.json', zeroCoefficientTeacher),
});
assert.notEqual(zeroCoefficients.result.status, 0);
assert.match(zeroCoefficients.result.stderr, /exact coefficients contain no positive Ridge or Non-Ridge optical mass/);

const wrongTeacherSupport = JSON.parse(readFileSync(teacherPath, 'utf8'));
wrongTeacherSupport.supportNativeCellIndexSha256 = 'b'.repeat(64);
const teacherSupportDrift = run({ teacher: writeJson('teacher-wrong-support.json', wrongTeacherSupport) });
assert.notEqual(teacherSupportDrift.result.status, 0);
assert.match(teacherSupportDrift.result.stderr, /teacher support identity drifted/);

const wrongTargetCoefficient = JSON.parse(readFileSync(teacherPath, 'utf8'));
wrongTargetCoefficient.targets[7].coefficientArtifactSha256 = 'c'.repeat(64);
const targetCoefficientDrift = run({ teacher: writeJson('teacher-target-wrong-coefficient.json', wrongTargetCoefficient) });
assert.notEqual(targetCoefficientDrift.result.status, 0);
assert.match(targetCoefficientDrift.result.stderr, /teacher camera 7 coefficient artifact hash drifted/);

const signatureOnlyTeacher = JSON.parse(readFileSync(teacherPath, 'utf8'));
const signatureOnlyBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
writeFileSync(signatureOnlyTeacher.targets[3].artifact.path, signatureOnlyBytes);
signatureOnlyTeacher.targets[3].artifact.bytes = signatureOnlyBytes.length;
signatureOnlyTeacher.targets[3].artifact.sha256 = sha256(signatureOnlyBytes);
const signatureOnly = run({ teacher: writeJson('teacher-signature-only-png.json', signatureOnlyTeacher) });
assert.notEqual(signatureOnly.result.status, 0);
assert.match(signatureOnly.result.stderr, /PNG is truncated before IHDR/);
writePngArtifact('teacher-camera-03.png', targetWidth, targetHeight, 4, { semanticRole: 'exact-shared-transmittance-target' });

const wrongDimensionTeacher = JSON.parse(readFileSync(teacherPath, 'utf8'));
wrongDimensionTeacher.targets[5].artifact = writePngArtifact(
  'teacher-camera-05-wrong-dimensions.png', targetWidth - 1, targetHeight, 6, { semanticRole: 'exact-shared-transmittance-target' },
);
const targetDimensionDrift = run({ teacher: writeJson('teacher-wrong-png-dimensions.json', wrongDimensionTeacher) });
assert.notEqual(targetDimensionDrift.result.status, 0);
assert.match(targetDimensionDrift.result.stderr, /PNG dimensions drifted/);

const forgedComparison = JSON.parse(readFileSync(comparisonPath, 'utf8'));
forgedComparison.experiment.originalEvidenceImmutable = false;
const mutableComparison = run({ comparison: writeJson('grid160-forged.json', forgedComparison) });
assert.notEqual(mutableComparison.result.status, 0);
assert.equal(JSON.parse(readFileSync(mutableComparison.report, 'utf8')).failurePhase, 'grid160-comparison-validation');

const argumentReport = join(scratch, 'argument-failure-report.json');
const argumentOut = join(scratch, 'argument-failure-out.json');
const argumentFailure = spawnSync(process.execPath, [producer, '--report', argumentReport, '--out', argumentOut], { cwd: root, encoding: 'utf8' });
assert.notEqual(argumentFailure.status, 0);
assert.equal(JSON.parse(readFileSync(argumentReport, 'utf8')).failurePhase, 'argument-validation');
assert.equal(JSON.parse(readFileSync(argumentOut, 'utf8')).status, 'failed');

console.log(JSON.stringify({ ok: true, report: success.report }, null, 2));
rmSync(scratch, { recursive: true, force: true });
