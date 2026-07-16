import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS } from './boundary-splat-feature-capture.mjs';

export const BOUNDARY_SPLAT_APPEARANCE_SCHEMA = 'kaminos-boundary-splat-appearance-coefficient-corpus-v0';
export const BOUNDARY_SPLAT_APPEARANCE_AUTHORITY = 'live-simulator-frozen-state-multi-camera-signed-appearance-coefficients-v0';
export const BOUNDARY_SPLAT_APPEARANCE_CONDITIONING_IDENTITY = 'boundary-splat-authored-appearance-conditioning-v0';

const APPEARANCE_RECEIPT_IDENTITY = 'appearance-decomposition-receipt-v0';
const COEFFICIENT_BOUNDARY = 'per-sample-pre-tone-map-emission-extinction-v0';
const STRUCTURAL_A_IDENTITY = 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0';
const BROAD_CARRIER_IDENTITY = 'signed-control-minus-structural-a-local-coefficients-v0';
const OPTICAL_RECURRENCE = 'front-to-back-emission-with-exponential-transmittance-v0';
const BROAD_CARRIER_B_TARGET_IDENTITY = 'pre-tone-map-signed-broad-carrier-coefficients-v0';
const B_ON_A_TARGET_IDENTITY = 'pre-tone-map-b-optical-effect-on-fixed-structural-a-v0';
const A_PLUS_B_TARGET_IDENTITY = 'nonlinear-optical-a-plus-b-recomposition-v0';
const SMOKE_OFF_CONTROL_TARGET_IDENTITY = 'smoke-off-beauty-optical-control-v0';
const RAYMARCH_RENDERER_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const TARGET_AUTHORITY = 'gpu-rgba8-raymarch-readback-frozen-sim-state';
const COUPLING_TERMS = [
  'b-emission-transported-through-a-plus-b-transmittance',
  'b-extinction-modulates-downstream-a-and-b-emission',
  'signed-b-coefficients-are-not-an-independent-positive-radiance-field',
];
const APPEARANCE_CONTROL_KEYS = [
  'reactionBoundaryFireRidge',
  'reactionBoundaryFireRidgeCut',
  'reactionBoundaryFireTip',
  'reactionBoundaryFireErosion',
  'reactionBoundaryFireCleanBlue',
  'reactionBoundaryFireSoot',
  'reactionBoundaryFireYellow',
  'reactionBoundaryFireWarmth',
  'reactionBoundaryFireLuma',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifactPath(manifestPath, value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('artifact path must be nonblank');
  return isAbsolute(value) ? value : resolve(dirname(manifestPath), value);
}

async function validateArtifact(manifestPath, artifact, label) {
  if (!artifact || typeof artifact !== 'object') throw new Error(`${label} artifact is missing`);
  const path = artifactPath(manifestPath, artifact.path);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw new Error(`${label} artifact is blank`);
  if (artifact.bytes !== bytes.length) throw new Error(`${label} bytes mismatch: declared ${artifact.bytes}, actual ${bytes.length}`);
  const digest = sha256(bytes);
  if (artifact.sha256 !== digest) throw new Error(`${label} sha256 mismatch: declared ${artifact.sha256}, actual ${digest}`);
  return { path, bytes, digest };
}

function finiteArray(values, length, label) {
  if (!Array.isArray(values) || values.length !== length || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} must contain ${length} finite values`);
  }
}

function validateCamera(camera, label) {
  finiteArray(camera?.viewProjection, 16, `${label} viewProjection`);
  finiteArray(camera?.cameraRight, 3, `${label} right`);
  finiteArray(camera?.cameraUp, 3, `${label} up`);
  finiteArray(camera?.viewport, 2, `${label} viewport`);
  if (camera.viewport.some(value => value <= 0)) throw new Error(`${label} viewport must be positive`);
  return JSON.stringify({
    viewProjection: camera.viewProjection,
    cameraRight: camera.cameraRight,
    cameraUp: camera.cameraUp,
    viewport: camera.viewport,
  });
}

function validateTargetIdentity(target, label, expected) {
  if (!target || typeof target !== 'object') throw new Error(`${label} target is missing`);
  if (target.authority !== TARGET_AUTHORITY) throw new Error(`${label} authority is not frozen GPU raymarch readback`);
  if (target.rendererIdentity !== RAYMARCH_RENDERER_IDENTITY) throw new Error(`${label} renderer identity is not native raymarch`);
  if (target.decomposition !== expected.decomposition) throw new Error(`${label} decomposition must equal ${expected.decomposition}`);
  if (target.presentationTargetIdentity !== expected.presentationTargetIdentity) {
    throw new Error(`${label} presentation target identity must equal ${expected.presentationTargetIdentity}`);
  }
}

function validateTargetState(target, cameraEntry, manifest, label) {
  if (target.sameStateCaptureId !== manifest.sameStateCaptureId || target.sameStateCaptureId !== cameraEntry.sameStateCaptureId) {
    throw new Error(`${label} same-state identity does not match the frozen cohort`);
  }
  if (target.simStepCount !== manifest.simStepCount || target.simStepCount !== cameraEntry.simStepCount) {
    throw new Error(`${label} simulator step does not match the frozen cohort`);
  }
  if (target.cameraId !== cameraEntry.id) throw new Error(`${label} camera identity does not match the camera entry`);
}

function validateExactTeacher(target, label, expectedRaySteps, expectedRenderScale) {
  if (expectedRaySteps != null) {
    if (target.requestedRaySteps !== expectedRaySteps) {
      throw new Error(`${label} requested ray steps must equal ${expectedRaySteps}, received ${target.requestedRaySteps}`);
    }
    if (target.effectiveRaySteps !== expectedRaySteps) {
      throw new Error(`${label} effective ray steps must equal ${expectedRaySteps}, received ${target.effectiveRaySteps}`);
    }
  }
  if (expectedRenderScale != null && Math.abs(Number(target.renderScale) - expectedRenderScale) > 0.001) {
    throw new Error(`${label} render scale must equal ${expectedRenderScale}, received ${target.renderScale}`);
  }
}

function validateAppearanceReceipt(target, label, mode, targetIdentity) {
  const receipt = target.appearanceDecompositionReceipt;
  if (!receipt || typeof receipt !== 'object') throw new Error(`${label} appearance decomposition receipt is missing`);
  if (receipt.identity !== APPEARANCE_RECEIPT_IDENTITY) throw new Error(`${label} appearance decomposition receipt identity is invalid`);
  if (receipt.fallbackReason != null) throw new Error(`${label} appearance decomposition contains fallback evidence: ${receipt.fallbackReason}`);
  if (receipt.requestedMode !== mode || receipt.normalizedRequestedMode !== mode || receipt.effectiveMode !== mode) {
    throw new Error(`${label} appearance decomposition mode must remain exactly ${mode}`);
  }
  if (receipt.targetIdentity !== targetIdentity) throw new Error(`${label} target identity must equal ${targetIdentity}`);
  if (receipt.coefficientBoundary !== COEFFICIENT_BOUNDARY) throw new Error(`${label} coefficient boundary is not the exact local pre-tone-map contract`);
  if (receipt.structuralAIdentity !== STRUCTURAL_A_IDENTITY) throw new Error(`${label} structural A identity is invalid`);
  if (receipt.broadCarrierIdentity !== BROAD_CARRIER_IDENTITY) throw new Error(`${label} signed B coefficient authority is invalid`);
  if (receipt.opticalRecurrence !== OPTICAL_RECURRENCE) throw new Error(`${label} optical recurrence identity is invalid`);
  if (receipt.simulationAdvanced !== false || receipt.simulationReset !== false
    || receipt.cameraMutated !== false || receipt.controlsMutated !== false) {
    throw new Error(`${label} appearance assay mutated simulation, reset, camera, or controls`);
  }
  for (const passSetName of ['requestedPasses', 'passes']) {
    const passes = receipt[passSetName];
    if (passes?.raymarchApplied !== true || passes?.splatsApplied !== false
      || passes?.residualApplied !== false || passes?.featureCaptureApplied !== false
      || passes?.smokeApplied !== false) {
      throw new Error(`${label} appearance decomposition must be exact raymarch-only evidence`);
    }
  }
  if (!Array.isArray(receipt.couplingTerms) || COUPLING_TERMS.some(term => !receipt.couplingTerms.includes(term))) {
    throw new Error(`${label} appearance decomposition omits signed optical coupling terms`);
  }
}

export async function validateBoundarySplatAppearanceCorpus(manifestFile, options = {}) {
  const manifestPath = resolve(manifestFile);
  const expectedGrid = options.expectedGrid == null ? 160 : Number(options.expectedGrid);
  const expectedRaySteps = options.expectedRaySteps == null ? null : Number(options.expectedRaySteps);
  const expectedRenderScale = options.expectedRenderScale == null ? null : Number(options.expectedRenderScale);
  if (!Number.isInteger(expectedGrid) || expectedGrid <= 0) throw new Error(`expected grid must be a positive integer, received ${options.expectedGrid}`);
  if (expectedRaySteps != null && (!Number.isInteger(expectedRaySteps) || expectedRaySteps <= 0)) {
    throw new Error(`expected ray steps must be a positive integer, received ${options.expectedRaySteps}`);
  }
  if (expectedRenderScale != null && (!Number.isFinite(expectedRenderScale) || expectedRenderScale <= 0 || expectedRenderScale > 1)) {
    throw new Error(`expected render scale must be finite within (0, 1], received ${options.expectedRenderScale}`);
  }

  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.length === 0) throw new Error('appearance corpus manifest is blank');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== BOUNDARY_SPLAT_APPEARANCE_SCHEMA) throw new Error(`appearance corpus schema must be ${BOUNDARY_SPLAT_APPEARANCE_SCHEMA}`);
  if (manifest.authority !== BOUNDARY_SPLAT_APPEARANCE_AUTHORITY) throw new Error(`appearance corpus authority must be ${BOUNDARY_SPLAT_APPEARANCE_AUTHORITY}`);
  if (typeof manifest.cohortIdentity !== 'string' || !manifest.cohortIdentity) throw new Error('appearance corpus cohort identity is missing');
  if (typeof manifest.sameStateCaptureId !== 'string' || !manifest.sameStateCaptureId) throw new Error('appearance corpus same-state identity is missing');
  if (!Number.isInteger(manifest.simStepCount) || manifest.simStepCount < 0) throw new Error('appearance corpus simulator step must be a non-negative integer');
  if (manifest.grid !== expectedGrid) throw new Error(`appearance corpus grid must equal ${expectedGrid}, received ${manifest.grid}`);
  if (typeof manifest.requestedRoute !== 'string' || !manifest.requestedRoute || typeof manifest.effectiveRoute !== 'string' || !manifest.effectiveRoute) {
    throw new Error('appearance corpus must preserve requested and effective routes');
  }
  if (manifest.prototypeIdentity !== 'kaminos-volume-prototype-v0') throw new Error('appearance corpus prototype identity is invalid');
  if (options.requireWebGpuBackend === true && (typeof manifest.backend !== 'string' || !manifest.backend.startsWith('WebGPU:'))) {
    throw new Error('appearance corpus backend must preserve effective WebGPU identity');
  }
  if (manifest.fallbackReason != null) throw new Error(`appearance corpus contains fallback evidence: ${manifest.fallbackReason}`);

  const conditioning = manifest.authoredAppearanceControls;
  if (!conditioning || conditioning.identity !== BOUNDARY_SPLAT_APPEARANCE_CONDITIONING_IDENTITY
    || conditioning.authority !== 'effective-runtime-controls-frozen-sim-state-v0') {
    throw new Error('appearance corpus authored appearance conditioning identity or authority is invalid');
  }
  for (const key of APPEARANCE_CONTROL_KEYS) {
    if (typeof conditioning.values?.[key] !== 'number' || !Number.isFinite(conditioning.values[key])) {
      throw new Error(`appearance corpus authored appearance control ${key} must be finite`);
    }
  }

  if (manifest.candidates?.sameStateCaptureId !== manifest.sameStateCaptureId) {
    throw new Error('candidate same-state identity does not match the appearance cohort');
  }
  if (manifest.candidates?.simStepCount !== manifest.simStepCount) throw new Error('candidate simulator step does not match the appearance cohort');
  const candidateArtifact = await validateArtifact(manifestPath, manifest.candidates, 'candidate');
  if (manifest.candidates.dtype !== 'float32-le'
    || manifest.candidates.strideFloats !== BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS
    || !Number.isInteger(manifest.candidates.count) || manifest.candidates.count <= 0) {
    throw new Error(`candidate layout must be positive-count float32-le with stride ${BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS}`);
  }
  const expectedCandidateBytes = manifest.candidates.count * manifest.candidates.strideFloats * 4;
  if (candidateArtifact.bytes.length !== expectedCandidateBytes) {
    throw new Error(`candidate bytes mismatch for count/stride: expected ${expectedCandidateBytes}, actual ${candidateArtifact.bytes.length}`);
  }
  const candidateView = new DataView(candidateArtifact.bytes.buffer, candidateArtifact.bytes.byteOffset, candidateArtifact.bytes.byteLength);
  for (let byteOffset = 0; byteOffset < candidateArtifact.bytes.length; byteOffset += 4) {
    if (!Number.isFinite(candidateView.getFloat32(byteOffset, true))) throw new Error('candidate data contains non-finite values');
  }

  if (!Array.isArray(manifest.cameras) || manifest.cameras.length < 2) throw new Error('appearance corpus must contain multiple cameras');
  const cameraIds = new Set();
  const cameraSignatures = new Set();
  const cameras = [];
  let trainCameraCount = 0;
  let heldoutCameraCount = 0;
  for (const [index, entry] of manifest.cameras.entries()) {
    const label = `camera ${index}`;
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) throw new Error(`${label} identity is missing`);
    if (cameraIds.has(entry.id)) throw new Error(`${label} identity is duplicated`);
    cameraIds.add(entry.id);
    if (entry.split === 'train') trainCameraCount += 1;
    else if (entry.split === 'heldout') heldoutCameraCount += 1;
    else throw new Error(`${label} split must be train or heldout`);
    if (entry.sameStateCaptureId !== manifest.sameStateCaptureId) throw new Error(`${label} same-state identity does not match the frozen cohort`);
    if (entry.simStepCount !== manifest.simStepCount) throw new Error(`${label} simulator step does not match the frozen cohort`);
    const cameraSignature = validateCamera(entry.camera, label);
    if (cameraSignatures.has(cameraSignature)) throw new Error(`${label} does not provide a distinct camera from the cohort`);
    cameraSignatures.add(cameraSignature);

    const targets = [
      ['structuralA', 'structural A', 'structural-a', STRUCTURAL_A_IDENTITY],
      ['appearanceBroadCarrierB', 'broad-carrier B', 'broad-carrier-b', BROAD_CARRIER_B_TARGET_IDENTITY],
      ['appearanceBAppliedToFixedA', 'B applied to fixed A', 'b-applied-to-fixed-a', B_ON_A_TARGET_IDENTITY],
      ['appearanceAPlusB', 'A+B recomposition', 'a-plus-b-recomposition', A_PLUS_B_TARGET_IDENTITY],
      ['smokeOffBeautyControl', 'smoke-off optical control', 'smoke-off-beauty-control', SMOKE_OFF_CONTROL_TARGET_IDENTITY],
    ];
    const artifacts = {};
    for (const [key, targetLabel, mode, targetIdentity] of targets) {
      const target = entry[key];
      if (!target) throw new Error(`${label} ${targetLabel} target is missing`);
      validateTargetIdentity(target, `${label} ${targetLabel}`, {
        decomposition: targetIdentity,
        presentationTargetIdentity: targetIdentity,
      });
      validateTargetState(target, entry, manifest, `${label} ${targetLabel}`);
      validateExactTeacher(target, `${label} ${targetLabel}`, expectedRaySteps, expectedRenderScale);
      validateAppearanceReceipt(target, `${label} ${targetLabel}`, mode, targetIdentity);
      artifacts[key] = await validateArtifact(manifestPath, target, `${label} ${targetLabel}`);
    }
    if (entry.appearanceBAppliedToFixedA.trainingAuthority !== 'diagnostic-only-not-local-b-target') {
      throw new Error(`${label} B applied to fixed A must remain diagnostic-only, not a nominal local B target`);
    }
    if (artifacts.appearanceAPlusB.digest !== artifacts.smokeOffBeautyControl.digest
      || artifacts.appearanceAPlusB.bytes.length !== artifacts.smokeOffBeautyControl.bytes.length) {
      throw new Error(`${label} exact A+B recomposition does not byte-match the smoke-off optical control`);
    }

    cameras.push({
      id: entry.id,
      split: entry.split,
      structuralAPath: artifacts.structuralA.path,
      appearanceBroadCarrierBPath: artifacts.appearanceBroadCarrierB.path,
      appearanceBAppliedToFixedAPath: artifacts.appearanceBAppliedToFixedA.path,
      appearanceAPlusBPath: artifacts.appearanceAPlusB.path,
      smokeOffBeautyControlPath: artifacts.smokeOffBeautyControl.path,
      camera: entry.camera,
    });
  }
  if (trainCameraCount === 0) throw new Error('appearance corpus must contain at least one train camera');
  if (heldoutCameraCount === 0) throw new Error('appearance corpus must contain at least one heldout camera');

  return {
    schema: BOUNDARY_SPLAT_APPEARANCE_SCHEMA,
    corpusIdentity: `sha256:${sha256(manifestBytes)}`,
    manifestPath,
    cohortIdentity: manifest.cohortIdentity,
    sameStateCaptureId: manifest.sameStateCaptureId,
    simStepCount: manifest.simStepCount,
    grid: manifest.grid,
    backend: manifest.backend,
    candidatePath: candidateArtifact.path,
    candidateSha256: candidateArtifact.digest,
    candidateCount: manifest.candidates.count,
    cameraCount: cameras.length,
    trainCameraCount,
    heldoutCameraCount,
    authoredAppearanceControls: conditioning.values,
    cameras,
  };
}
