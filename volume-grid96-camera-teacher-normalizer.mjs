#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRID96_CAMERA_COHORT_IDENTITY = 'filament-orbit-21-camera-yaw-v0';
export const GRID96_TEACHER_IDENTITY = 'exact-same-state-shared-transmittance-intrinsic-target-v0';

const ORBIT_SCHEMA = 'kaminos.volume.raymarch-filament-orbit-witness.v0';
const ORACLE_SCHEMA = 'kaminos.volume.layer-coefficient-render-oracle.v0';
const EXPECTED_ANGLES = Object.freeze(Array.from({ length: 21 }, (_, index) => Number((-0.42 + index * 0.042).toFixed(3))));
const TARGET_MODE = 'sharedTransmittanceContributionSum';
const TARGET_WIDTH = 314;
const TARGET_HEIGHT = 242;
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function buildGrid96CameraTeacherComponents(inputs) {
  const { source, support, coefficients, orbit, oracle, sourceManifestSha256 } = inputs;
  validateNativeInputs(source, support, coefficients, sourceManifestSha256);
  const targets = validateOrbit(orbit, source);
  validateOracle(oracle, orbit, support, coefficients);

  const base = {
    schema: 'kaminos.volume.grid96-native-component.v0',
    status: 'complete',
    failurePhase: null,
    grid: 96,
    sameStateCaptureId: source.sameStateCaptureId,
    simStepCount: source.simStepCount,
    requestedControlIdentity: source.requestedControlIdentity,
    effectiveControlIdentity: source.effectiveControlIdentity,
    sourceManifestSha256,
  };
  const indices = Array.from({ length: 21 }, (_, index) => index);
  const cameras = {
    ...base,
    role: 'camera-cohort',
    route: clone(source.route),
    identity: GRID96_CAMERA_COHORT_IDENTITY,
    indices,
    angles: [...EXPECTED_ANGLES],
    calibrationCameraIndex: 10,
    heldOutCameraIndices: indices.filter(index => index !== 10),
    orbitWitnessSameStateCaptureId: orbit.frozenState.sameStateCaptureId,
    orbitControlsHash: orbit.frozenState.controlsHash,
    cameras: targets.map(target => ({
      id: `camera-${String(target.cameraIndex).padStart(2, '0')}`,
      index: target.cameraIndex,
      angle: target.cameraAngle,
      split: target.cameraIndex === 10 ? 'calibration' : 'heldout',
      pose: {
        position: [...target.cameraPose.position],
        target: [...target.cameraPose.target],
      },
      poseHash: target.cameraPoseHash,
    })),
  };

  const teacher = {
    ...base,
    role: 'teacher',
    sourceRoute: clone(source.route),
    identity: GRID96_TEACHER_IDENTITY,
    coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
    transportIdentity: 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0',
    compositionIdentity: 'one-globally-ordered-stream-v0',
    rendererIdentity: 'offline-exact-coefficient-shared-transmittance-oracle-v0',
    cameraCohortIdentity: GRID96_CAMERA_COHORT_IDENTITY,
    cameraCount: 21,
    calibrationCameraIndex: 10,
    heldOutCameraIndices: indices.filter(index => index !== 10),
    targetCount: 21,
    targetWidth: TARGET_WIDTH,
    targetHeight: TARGET_HEIGHT,
    supportNativeCellIndexSha256: support.nativeCellIndexSha256,
    coefficientArtifactSha256: coefficients.artifact.sha256,
    orbitWitnessSameStateCaptureId: orbit.frozenState.sameStateCaptureId,
    orbitControlsHash: orbit.frozenState.controlsHash,
    executionRoute: {
      requested: `python volume-layer-coefficient-render-oracle.py --state-step ${oracle.requested.stateStep} --depth-bins ${oracle.requested.depthBins} --sample-cap none`,
      effective: `python volume-layer-coefficient-render-oracle.py --state-step ${oracle.effective.stateStep} --depth-bins ${oracle.requested.depthBins} --sample-cap none`,
      backend: 'python-numpy-cpu-v0',
      fallbackUsed: false,
      failurePhase: null,
      sampleCap: null,
    },
    targets: targets.map(target => ({
      cameraIndex: target.cameraIndex,
      cameraId: `camera-${String(target.cameraIndex).padStart(2, '0')}`,
      split: target.cameraIndex === 10 ? 'calibration' : 'heldout',
      sameStateCaptureId: source.sameStateCaptureId,
      simStepCount: source.simStepCount,
      sourceManifestSha256,
      supportNativeCellIndexSha256: support.nativeCellIndexSha256,
      coefficientArtifactSha256: coefficients.artifact.sha256,
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      orbitPixelHash: target.pixelHash,
      artifact: pngArtifact(target.imagePath),
    })),
  };
  return { cameras, teacher };
}

function validateNativeInputs(source, support, coefficients, sourceManifestSha256) {
  assert.match(sourceManifestSha256 || '', /^[0-9a-f]{64}$/, 'source manifest sha256 is invalid');
  for (const [role, value] of [['source', source], ['support', support], ['coefficients', coefficients]]) {
    assert.equal(value?.status, 'complete', `${role} is not complete`);
    assert.equal(value.failurePhase, null, `${role} carries a failure phase`);
    assert.equal(value.grid, 96, `${role} is not native grid96`);
    assert.equal(value.simStepCount, 120, `${role} is not exact state 120`);
    assert.equal(value.requestedControlIdentity, source.requestedControlIdentity, `${role} requested controls drifted`);
    assert.equal(value.effectiveControlIdentity, source.effectiveControlIdentity, `${role} effective controls drifted`);
  }
  assert.equal(source.requestedControlIdentity, source.effectiveControlIdentity, 'source controls were substituted');
  assert.equal(support.sourceManifestSha256, sourceManifestSha256, 'support source manifest drifted');
  assert.equal(coefficients.sourceManifestSha256, sourceManifestSha256, 'coefficient source manifest drifted');
  assert.equal(coefficients.nativeCellIndexSha256, support.nativeCellIndexSha256, 'coefficient support index drifted');
  assert.equal(coefficients.rowCount, support.rowCount, 'coefficient row count drifted');
  assert.equal(support.sampleCap, null, 'support contains a sampleCap');
  assert.equal(support.droppedRowCount, 0, 'support dropped rows');
  assert.equal(support.overflowCount, 0, 'support overflowed');
}

function validateOrbit(orbit, source) {
  assert.equal(orbit?.schema, ORBIT_SCHEMA, 'orbit witness schema drifted');
  assert.equal(orbit.status, 'complete', 'orbit witness is not complete');
  assert.ok(orbit.failurePhase == null, 'orbit witness carries a failure phase');
  assert.equal(orbit.effectiveRendererRoute, 'native-3d-compute-fluid-raymarch-v0', 'orbit renderer route fell back');
  assert.deepEqual(orbit.captureConfig?.orbitAngles, EXPECTED_ANGLES, 'orbit angles drifted');
  assert.deepEqual(orbit.captureConfig?.rayStepCounts, [48, 96, 160], 'orbit ray-step receipts are partial');
  assert.equal(orbit.captureConfig?.simulatorAdvance, false, 'orbit advanced the simulator');
  assert.equal(orbit.captureConfig?.smoke, 'off', 'orbit target contains smoke');
  assert.equal(orbit.captureConfig?.expectedFrameCount, 120, 'orbit frame authority drifted');
  assert.equal(orbit.captureConfig?.expectedSimStepCount, 120, 'orbit simulation authority drifted');
  assert.equal(orbit.captureConfig?.expectedWarmupAuthority, 'imported-field-checksum-anchor-v0', 'orbit import authority drifted');
  assert.equal(orbit.captureConfig?.expectedWarmupTarget, 120, 'orbit import target drifted');
  assert.equal(orbit.captureConfig?.expectedAnchorFluidSha256, source.sidecars.fluid.sha256, 'orbit fluid source hash drifted');
  assert.equal(orbit.captureConfig?.expectedAnchorFrontSha256, source.sidecars.front.sha256, 'orbit front source hash drifted');
  assert.equal(orbit.frozenState?.baseFrameCount, 120, 'orbit frozen frame step drifted');
  assert.equal(orbit.frozenState?.baseSimStepCount, 120, 'orbit frozen simulator step drifted');
  assert.equal(orbit.frozenState?.controlsHash, orbit.captureConfig.expectedControlsHash, 'orbit frozen controls hash drifted');
  assert.equal(orbit.importedFieldReceipt?.effective?.grid, 96, 'orbit imported a non-grid96 field');
  assert.equal(orbit.importedFieldReceipt?.effective?.fluidSha256, source.sidecars.fluid.sha256, 'imported fluid hash drifted');
  assert.equal(orbit.importedFieldReceipt?.effective?.frontSha256, source.sidecars.front.sha256, 'imported front hash drifted');
  assert.equal(orbit.importedFieldReceipt?.effective?.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'imported field route fell back');
  assert.ok(orbit.importedFieldReceipt?.effective?.backend?.startsWith('WebGPU:'), 'imported field backend is not WebGPU');

  const targets = (orbit.captures || []).filter(capture => capture.mode === TARGET_MODE && capture.requestedRaySteps === 160);
  targets.sort((left, right) => left.cameraIndex - right.cameraIndex);
  assert.equal(targets.length, 21, 'orbit target cohort is partial');
  assert.deepEqual(targets.map(target => target.cameraIndex), Array.from({ length: 21 }, (_, index) => index), 'orbit target cameras are partial');
  assert.equal(new Set(targets.map(target => target.cameraPoseHash)).size, 21, 'orbit reused a cached or duplicated camera pose');
  for (const target of targets) {
    assert.equal(target.cameraAngle, EXPECTED_ANGLES[target.cameraIndex], `camera ${target.cameraIndex} angle drifted`);
    assert.equal(target.sameStateCaptureId, orbit.frozenState.sameStateCaptureId, `camera ${target.cameraIndex} same-state identity drifted`);
    assert.equal(target.frameCount, 120, `camera ${target.cameraIndex} frame step drifted`);
    assert.equal(target.simStepCount, 120, `camera ${target.cameraIndex} simulator step drifted`);
    assert.equal(target.effectiveRaySteps, 160, `camera ${target.cameraIndex} effective ray steps drifted`);
    assert.equal(target.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', `camera ${target.cameraIndex} route fell back`);
    assert.ok(target.backend?.startsWith('WebGPU:'), `camera ${target.cameraIndex} backend is not WebGPU`);
    assert.equal(target.width, TARGET_WIDTH, `camera ${target.cameraIndex} target width drifted`);
    assert.equal(target.height, TARGET_HEIGHT, `camera ${target.cameraIndex} target height drifted`);
    assert.equal(target.metrics?.nonblank, true, `camera ${target.cameraIndex} target is blank`);
    assert.ok(target.metrics?.litPixels > 0, `camera ${target.cameraIndex} target has no lit pixels`);
    finiteArray(target.cameraPose?.position, 3, `camera ${target.cameraIndex} position`);
    finiteArray(target.cameraPose?.target, 3, `camera ${target.cameraIndex} target`);
    pngArtifact(target.imagePath);
  }
  return targets;
}

function validateOracle(oracle, orbit, support, coefficients) {
  assert.equal(oracle?.schema, ORACLE_SCHEMA, 'oracle schema drifted');
  assert.equal(oracle.status, 'complete', 'oracle is not complete');
  assert.equal(oracle.failurePhase, null, 'oracle carries a failure phase');
  assert.equal(oracle.requested?.stateStep, 120, 'oracle requested state drifted');
  assert.equal(oracle.effective?.stateStep, 120, 'oracle effective state drifted');
  assert.equal(oracle.requested?.sampleCap, null, 'oracle requested a sampleCap');
  assert.equal(oracle.effective?.sampleCap, null, 'oracle applied a sampleCap');
  assert.equal(oracle.effective?.droppedRowCount, 0, 'oracle dropped rows');
  assert.equal(oracle.effective?.rowCount, support.rowCount, 'oracle support row count drifted');
  assert.equal(oracle.effective?.coefficientBoundary, 'per-sample-pre-tone-map-emission-extinction-v0', 'oracle coefficient boundary drifted');
  assert.equal(oracle.effective?.sharedTransmittanceIdentity, 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0', 'oracle transport identity drifted');
  assert.equal(oracle.effective?.coefficientSourceAuthority, 'exact-local-layer-emission-extinction-v0', 'oracle coefficient source is not exact');
  assert.match(oracle.effective?.orderApproximation || '', /one-running-transmittance-v0$/, 'oracle transport is not one ordered stream');
  assert.equal(oracle.frozenStateBinding?.sameStateCaptureId, orbit.frozenState.sameStateCaptureId, 'oracle orbit state identity drifted');
  assert.equal(oracle.frozenStateBinding?.controlsHash, orbit.frozenState.controlsHash, 'oracle controls hash drifted');
  assert.equal(oracle.frozenStateBinding?.fluidSha256, orbit.captureConfig.expectedAnchorFluidSha256, 'oracle fluid source hash drifted');
  assert.equal(oracle.frozenStateBinding?.frontSha256, orbit.captureConfig.expectedAnchorFrontSha256, 'oracle front source hash drifted');
  assert.equal(oracle.frozenStateBinding?.hashMatch, true, 'oracle source hashes did not match');
  assert.equal(oracle.descriptorReceipt?.indexSha256, support.nativeCellIndexSha256, 'oracle support index drifted');
  assert.equal(oracle.effective?.rowCount, coefficients.rowCount, 'oracle coefficient rows drifted');
  assert.equal(oracle.artifacts?.cameraCount, 21, 'oracle target cohort is partial');
  const cameras = oracle.metrics?.cameras || [];
  assert.equal(cameras.length, 21, 'oracle camera metrics are partial');
  assert.deepEqual(cameras.map(camera => camera.cameraIndex), Array.from({ length: 21 }, (_, index) => index), 'oracle camera metrics are misordered');
  for (const camera of cameras) {
    assert.equal(camera.cameraAngle, EXPECTED_ANGLES[camera.cameraIndex], `oracle camera ${camera.cameraIndex} angle drifted`);
    const expectedSplit = camera.cameraIndex === 10 ? 'calibration' : 'heldOut';
    assert.equal(camera.split, expectedSplit, `oracle camera ${camera.cameraIndex} split drifted`);
  }
}

function pngArtifact(path) {
  assert.ok(isAbsolute(path || ''), 'teacher target path must be absolute');
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 0, 'teacher target PNG is blank');
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'teacher target is not PNG');
  assert.equal(bytes.readUInt32BE(16), TARGET_WIDTH, 'teacher target PNG width drifted');
  assert.equal(bytes.readUInt32BE(20), TARGET_HEIGHT, 'teacher target PNG height drifted');
  return {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    semanticRole: 'exact-shared-transmittance-target',
  };
}

function finiteArray(value, length, label) {
  assert.ok(Array.isArray(value) && value.length === length && value.every(Number.isFinite), `${label} must contain ${length} finite values`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const reportPath = resolve(arg('--report') || 'grid96-camera-teacher-normalizer-report.json');
  const camerasPath = resolve(arg('--cameras-out') || 'grid96-camera-cohort-manifest.json');
  const teacherPath = resolve(arg('--teacher-out') || 'grid96-teacher-manifest.json');
  let failurePhase = 'argument-validation';
  const lastTrustworthyEvidence = { argv: process.argv.slice(2) };
  try {
    const sourcePath = resolve(arg('--source-manifest'));
    const supportPath = resolve(arg('--support-manifest'));
    const coefficientPath = resolve(arg('--coefficient-manifest'));
    const orbitPath = resolve(arg('--orbit-report'));
    const oraclePath = resolve(arg('--oracle-report'));
    const sourceManifestSha256 = sha256(readFileSync(sourcePath));
    failurePhase = 'component-validation';
    const built = buildGrid96CameraTeacherComponents({
      source: readJson(sourcePath),
      support: readJson(supportPath),
      coefficients: readJson(coefficientPath),
      orbit: readJson(orbitPath),
      oracle: readJson(oraclePath),
      sourceManifestSha256,
    });
    failurePhase = 'artifact-write';
    writeJsonAtomic(camerasPath, built.cameras);
    writeJsonAtomic(teacherPath, built.teacher);
    writeJsonAtomic(reportPath, {
      schema: 'kaminos.volume.grid96-camera-teacher-normalizer-report.v0',
      status: 'complete',
      failurePhase: null,
      sourceManifestSha256,
      orbitReportSha256: sha256(readFileSync(orbitPath)),
      oracleReportSha256: sha256(readFileSync(oraclePath)),
      cameras: { path: camerasPath, sha256: sha256(readFileSync(camerasPath)) },
      teacher: { path: teacherPath, sha256: sha256(readFileSync(teacherPath)) },
      claimBoundary: {
        causalQuestion: 'source-lattice-subcell-vs-deposit-space-quadrature-v0',
        cheaperDemoClaim: false,
        depositionAdjudication: false,
        learnerCampaign: false,
      },
    });
  } catch (error) {
    writeJsonAtomic(reportPath, {
      schema: 'kaminos.volume.grid96-camera-teacher-normalizer-report.v0',
      status: 'failed',
      failurePhase,
      error: String(error?.stack || error),
      lastTrustworthyEvidence,
    });
    throw error;
  }
}

if (isCli) main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
