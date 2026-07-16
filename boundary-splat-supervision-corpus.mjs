import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { BOUNDARY_SPLAT_ATTRIBUTE_FEATURES } from './boundary-splat-attribute-model.mjs';
import {
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER,
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS,
} from './boundary-splat-feature-capture.mjs';

export {
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER,
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS,
};

export const BOUNDARY_SPLAT_SUPERVISION_SCHEMA = 'kaminos-boundary-splat-supervision-corpus-v0';
export const BOUNDARY_SPLAT_STRUCTURAL_SUPERVISION_IDENTITY = 'native-boundary-sidecar-structural-supervision-v0';
export const BOUNDARY_SPLAT_CONTROL_CONDITIONING_IDENTITY = 'boundary-splat-emitter-lifecycle-conditioning-v0';
export const BOUNDARY_SPLAT_CONTROL_CONDITIONING_AUTHORITY = 'effective-runtime-controls-frozen-sim-state-v0';
export const BOUNDARY_SPLAT_FRESH_LIVE_ADMISSION_IDENTITY = 'fresh-live-selective-splat-capture-admission-v0';
export const BOUNDARY_SPLAT_FRESH_LIVE_ADMISSION_AUTHORITY = 'fresh-live-settings-no-anchor-v0';

const BOUNDARY_SPLAT_STRUCTURAL_STRUCTURE_CHANNELS = ['support', 'coverage', 'ridge', 'footprint'];
const BOUNDARY_SPLAT_STRUCTURAL_META_CHANNELS = ['proximity', 'normalX', 'normalY', 'normalZ'];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactArray(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} order must equal ${JSON.stringify(expected)}`);
  }
}

function finiteArray(values, expectedLength, label) {
  if (!Array.isArray(values) || values.length !== expectedLength || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} must contain ${expectedLength} finite values`);
  }
}

function validateControlConditioning(frame, label) {
  const conditioning = frame.controlConditioning;
  if (!conditioning || typeof conditioning !== 'object') throw new Error(`${label} control conditioning is missing`);
  if (conditioning.identity !== BOUNDARY_SPLAT_CONTROL_CONDITIONING_IDENTITY) throw new Error(`${label} control conditioning identity is invalid`);
  if (conditioning.authority !== BOUNDARY_SPLAT_CONTROL_CONDITIONING_AUTHORITY) throw new Error(`${label} control conditioning authority is invalid`);
  if (conditioning.sameStateCaptureId !== frame.sameStateCaptureId) throw new Error(`${label} control conditioning same-state identity does not match the frame`);
  if (conditioning.simStepCount !== frame.simStepCount) throw new Error(`${label} control conditioning simulator step does not match the frame`);
  const values = conditioning.values;
  if (!values || typeof values !== 'object') throw new Error(`${label} control conditioning values are missing`);
  for (const key of ['inputRadius', 'flowRate', 'fireScale', 'reactionFuelScale', 'lifecycleT', 'quenchVapor']) {
    if (typeof values[key] !== 'number' || !Number.isFinite(values[key])) throw new Error(`${label} control conditioning ${key} must be finite`);
  }
  if (values.inputRadius < 0.04) throw new Error(`${label} control conditioning inputRadius must be at least 0.04`);
  if (values.flowRate < 0) throw new Error(`${label} control conditioning flowRate must be non-negative`);
  if (!['none', 'snuff'].includes(values.lifecycleEffect)) throw new Error(`${label} control conditioning lifecycleEffect is invalid`);
  return conditioning;
}

function validateFreshLiveAdmission(frame, label) {
  const admission = frame.captureAdmission;
  if (!admission || typeof admission !== 'object') throw new Error(`${label} fresh-live capture admission is missing`);
  if (admission.identity !== BOUNDARY_SPLAT_FRESH_LIVE_ADMISSION_IDENTITY) throw new Error(`${label} fresh-live capture admission identity is invalid`);
  if (admission.authority !== BOUNDARY_SPLAT_FRESH_LIVE_ADMISSION_AUTHORITY) throw new Error(`${label} fresh-live capture admission authority is invalid`);
  if (admission.requestedRole !== 'truthHigh' || admission.effectiveRole !== 'truthHigh'
    || admission.roleAuthority !== 'current-high-field-reference-no-learned-composition-v0') {
    throw new Error(`${label} fresh-live requested/effective role is not truthHigh current-field authority`);
  }
  if (admission.requestedComposition !== 'splat-only-v0' || admission.effectiveComposition !== 'splat-only-v0'
    || admission.compositionAuthority !== 'splat-fire-authority-learned-boundary-sheets-v0') {
    throw new Error(`${label} fresh-live composition is not exact splat-only authority`);
  }
  const pass = admission.passReceipt;
  if (!pass || pass.composition !== 'splat-only-v0' || pass.raymarchEncoded !== false || pass.raymarchApplied !== false
    || pass.splatEncoded !== true || pass.splatApplied !== true || pass.fallbackReason != null) {
    throw new Error(`${label} fresh-live splat pass was not exclusively encoded and applied`);
  }
  if (admission.boundarySidecarSource === 'override' || admission.boundarySidecarOverrideReceipt != null) {
    throw new Error(`${label} fresh-live capture contains an external sidecar override`);
  }
  if (admission.boundarySidecarSource !== 'baked' || admission.boundarySidecarBuilt !== true
    || admission.boundarySidecarBuiltThisFrame !== true
    || admission.boundarySplatSourceAuthority !== 'live-baked-sidecar-plus-fluid-material-v0') {
    throw new Error(`${label} fresh-live sidecar was not baked from the current live field this frame`);
  }
  if (admission.fullFieldImportReceipt != null) throw new Error(`${label} fresh-live capture contains a full-field import receipt`);
  if (admission.replayAnchor != null) throw new Error(`${label} fresh-live capture contains a replay anchor`);
  if (admission.boundarySplatFallbackReason != null) throw new Error(`${label} fresh-live capture contains splat fallback evidence`);
  return admission;
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

function validateFloat32Artifact(bytes, label) {
  if (bytes.length % 4 !== 0) throw new Error(`${label} bytes must align to float32 values`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let byteOffset = 0; byteOffset < bytes.length; byteOffset += 4) {
    if (!Number.isFinite(view.getFloat32(byteOffset, true))) throw new Error(`${label} contains non-finite values`);
  }
}

export async function settleBoundarySplatRawRelease({
  primaryError = null,
  primaryPhase,
  releasePhase,
  release,
}) {
  if (typeof primaryPhase !== 'string' || !primaryPhase || typeof releasePhase !== 'string' || !releasePhase) {
    throw new Error('raw sidecar release custody requires primary and release phases');
  }
  if (typeof release !== 'function') throw new Error('raw sidecar release custody requires a release function');
  try {
    const receipt = await release();
    return {
      phase: primaryError ? primaryPhase : releasePhase,
      primaryError,
      releaseError: null,
      receipt,
    };
  } catch (releaseError) {
    if (primaryError) {
      primaryError.rawSidecarReleaseError = releaseError?.message || String(releaseError);
      return {
        phase: primaryPhase,
        primaryError,
        releaseError,
        receipt: null,
      };
    }
    releaseError.supervisionPhase = releasePhase;
    throw releaseError;
  }
}

export async function validateBoundarySplatSupervisionCorpus(manifestFile, options = {}) {
  const manifestPath = resolve(manifestFile);
  const expectedGrid = Number.isInteger(options.expectedGrid) && options.expectedGrid > 0
    ? options.expectedGrid
    : 160;
  const expectedRaySteps = options.expectedRaySteps == null ? null : Number(options.expectedRaySteps);
  const expectedRenderScale = options.expectedRenderScale == null ? null : Number(options.expectedRenderScale);
  if (expectedRaySteps != null && (!Number.isInteger(expectedRaySteps) || expectedRaySteps < 1 || expectedRaySteps > 160)) {
    throw new Error(`expected ray steps must be an integer within 1..160, received ${options.expectedRaySteps}`);
  }
  if (expectedRenderScale != null && (!Number.isFinite(expectedRenderScale) || expectedRenderScale <= 0 || expectedRenderScale > 1)) {
    throw new Error(`expected render scale must be finite within (0, 1], received ${options.expectedRenderScale}`);
  }
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.length === 0) throw new Error('corpus manifest is blank');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== BOUNDARY_SPLAT_SUPERVISION_SCHEMA) throw new Error(`corpus schema must be ${BOUNDARY_SPLAT_SUPERVISION_SCHEMA}`);
  if (manifest.authority !== 'live-simulator-frozen-state-candidate-raymarch-v0') throw new Error('corpus authority must preserve live frozen simulator state');
  exactArray(manifest.candidateOrder, BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER, 'candidate');
  exactArray(manifest.featureOrder, BOUNDARY_SPLAT_ATTRIBUTE_FEATURES, 'feature');
  if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) throw new Error('corpus must contain at least one frame');

  let candidateCount = 0;
  let structuralFrameCount = 0;
  const frames = [];
  for (const [index, frame] of manifest.frames.entries()) {
    const label = `frame ${index}`;
    if (!frame || typeof frame !== 'object') throw new Error(`${label} must be an object`);
    if (typeof frame.id !== 'string' || !frame.id || typeof frame.sameStateCaptureId !== 'string' || !frame.sameStateCaptureId) {
      throw new Error(`${label} must carry frame and same-state identities`);
    }
    if (!Number.isInteger(frame.simStepCount) || frame.simStepCount < 0 || !Number.isInteger(frame.grid) || frame.grid <= 0) {
      throw new Error(`${label} simStepCount and grid must be non-negative/positive integers`);
    }
    if (typeof frame.requestedRoute !== 'string' || !frame.requestedRoute || typeof frame.effectiveRoute !== 'string' || !frame.effectiveRoute) {
      throw new Error(`${label} must preserve requested and effective routes`);
    }
    if (frame.rendererIdentity !== 'live-boundary-sidecar-analytic-splats-v0') throw new Error(`${label} renderer identity is not the live analytic splat route`);
    if (frame.sourceAuthority !== 'live-baked-sidecar-plus-fluid-material-v0') throw new Error(`${label} source authority is not live baked sidecar plus fluid material`);
    if (frame.fallbackReason != null) throw new Error(`${label} contains fallback evidence: ${frame.fallbackReason}`);
    finiteArray(frame.camera?.viewProjection, 16, `${label} camera viewProjection`);
    finiteArray(frame.camera?.cameraRight, 3, `${label} camera right`);
    finiteArray(frame.camera?.cameraUp, 3, `${label} camera up`);
    finiteArray(frame.camera?.viewport, 2, `${label} camera viewport`);
    if (frame.camera.viewport.some(value => value <= 0)) throw new Error(`${label} camera viewport must be positive`);
    if (!frame.splatControls || typeof frame.splatControls !== 'object'
      || typeof frame.splatControls.radius !== 'number' || !Number.isFinite(frame.splatControls.radius) || frame.splatControls.radius <= 0
      || typeof frame.splatControls.sharpness !== 'number' || !Number.isFinite(frame.splatControls.sharpness) || frame.splatControls.sharpness <= 0) {
      throw new Error(`${label} splat controls must carry positive finite radius and sharpness`);
    }
    const controlConditioning = frame.controlConditioning != null
      ? validateControlConditioning(frame, label)
      : null;
    if (options.requireControlConditioning === true && controlConditioning == null) {
      throw new Error(`${label} control conditioning is required by this invocation`);
    }
    const captureAdmission = frame.captureAdmission != null
      ? validateFreshLiveAdmission(frame, label)
      : null;
    if (options.requireFreshLiveAdmission === true && captureAdmission == null) {
      throw new Error(`${label} fresh-live capture admission is required by this invocation`);
    }

    const candidateArtifact = await validateArtifact(manifestPath, frame.candidates, `${label} candidate`);
    if (frame.candidates.dtype !== 'float32-le' || frame.candidates.strideFloats !== BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS || !Number.isInteger(frame.candidates.count) || frame.candidates.count <= 0) {
      throw new Error(`${label} candidate layout must be positive-count float32-le with stride ${BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS}`);
    }
    const expectedCandidateBytes = frame.candidates.count * frame.candidates.strideFloats * 4;
    if (candidateArtifact.bytes.length !== expectedCandidateBytes) {
      throw new Error(`${label} candidate bytes mismatch for count/stride: expected ${expectedCandidateBytes}, actual ${candidateArtifact.bytes.length}`);
    }
    const candidateView = new DataView(candidateArtifact.bytes.buffer, candidateArtifact.bytes.byteOffset, candidateArtifact.bytes.byteLength);
    for (let byteOffset = 0; byteOffset < candidateArtifact.bytes.length; byteOffset += 4) {
      if (!Number.isFinite(candidateView.getFloat32(byteOffset, true))) throw new Error(`${label} candidate data contains non-finite values`);
    }

    const targetArtifact = await validateArtifact(manifestPath, frame.target, `${label} target`);
    if (frame.target.authority !== 'gpu-rgba8-raymarch-readback-frozen-sim-state') throw new Error(`${label} target authority is not frozen GPU raymarch readback`);
    if (frame.target.rendererIdentity !== 'native-3d-compute-fluid-raymarch-v0') throw new Error(`${label} target renderer identity is not the native raymarch`);
    if (frame.target.decomposition !== 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0') throw new Error(`${label} target decomposition is not exact candidate-support-gated intrinsic unit-gain native raymarch emission`);
    if (expectedRaySteps != null) {
      if (frame.target.requestedRaySteps !== expectedRaySteps) throw new Error(`${label} target requested ray steps must equal ${expectedRaySteps}, received ${frame.target.requestedRaySteps}`);
      if (frame.target.effectiveRaySteps !== expectedRaySteps) throw new Error(`${label} target effective ray steps must equal ${expectedRaySteps}, received ${frame.target.effectiveRaySteps}`);
    }
    if (expectedRenderScale != null && Math.abs(Number(frame.target.renderScale) - expectedRenderScale) > 0.001) {
      throw new Error(`${label} target render scale must equal ${expectedRenderScale}, received ${frame.target.renderScale}`);
    }
    let flowDebugArtifact = null;
    if (frame.flowDebug != null) {
      flowDebugArtifact = await validateArtifact(manifestPath, frame.flowDebug, `${label} flow debug`);
      if (frame.flowDebug.authority !== 'flow-debug-interface-canvas-capture-v0') throw new Error(`${label} flow-debug authority is not the established shader diagnostic`);
      if (frame.flowDebug.source !== 'volume_flow_debug') throw new Error(`${label} flow-debug source is not volume_flow_debug`);
      if (frame.flowDebug.sampleAuthority !== 'render-only-frozen-sim-state') throw new Error(`${label} flow-debug sample is not a frozen render-only state`);
      if (frame.flowDebug.sameStateCaptureId !== frame.sameStateCaptureId) throw new Error(`${label} flow-debug state identity does not match candidates and target`);
      if (frame.flowDebug.simStepCount !== frame.simStepCount) throw new Error(`${label} flow-debug simulator step does not match candidates and target`);
      if (frame.flowDebug.controlOverrides?.flowDebug !== 1) throw new Error(`${label} flow-debug control override is not exact`);
    }
    let structureArtifact = null;
    let metaArtifact = null;
    if (frame.structuralSupervision != null) {
      const structural = frame.structuralSupervision;
      if (frame.grid !== expectedGrid) throw new Error(`${label} structural supervision requires exact grid ${expectedGrid}, received ${frame.grid}`);
      if (manifest.warmup?.authority !== 'live-single-browser-sim-step-floor-v0'
        || !Number.isInteger(manifest.warmup.requestedMinSimStepCount) || manifest.warmup.requestedMinSimStepCount < 0
        || !Number.isInteger(manifest.warmup.achievedSimStepCount) || manifest.warmup.achievedSimStepCount < manifest.warmup.requestedMinSimStepCount
        || manifest.warmup.uncapped !== true) {
        throw new Error('structural supervision requires uncapped live single-browser warmup authority');
      }
      if (frame.simStepCount < manifest.warmup.requestedMinSimStepCount) throw new Error(`${label} structural supervision was captured before the warmup floor`);
      if (structural.identity !== BOUNDARY_SPLAT_STRUCTURAL_SUPERVISION_IDENTITY) throw new Error(`${label} structural supervision identity is invalid`);
      if (structural.authority !== 'live-native-boundary-sidecar-frozen-sim-state-v0') throw new Error(`${label} structural supervision authority is invalid`);
      if (structural.sameStateCaptureId !== frame.sameStateCaptureId) throw new Error(`${label} structural same-state identity does not match candidates and target`);
      if (structural.simStepCount !== frame.simStepCount) throw new Error(`${label} structural simulator step does not match candidates and target`);
      if (structural.requestedRoute !== frame.requestedRoute || structural.effectiveRoute !== frame.effectiveRoute) throw new Error(`${label} structural requested/effective route does not match the frame`);
      if (structural.prototypeIdentity !== 'kaminos-volume-prototype-v0') throw new Error(`${label} structural prototype identity is invalid`);
      if (typeof structural.backend !== 'string' || !structural.backend.startsWith('WebGPU:')) throw new Error(`${label} structural backend is not WebGPU`);
      if (structural.fallbackReason != null) throw new Error(`${label} structural supervision contains fallback evidence: ${structural.fallbackReason}`);
      if (structural.dtype !== 'float32-le' || structural.gridAuthority !== 'exact-frame-grid-v0') throw new Error(`${label} structural layout authority is invalid`);
      exactArray(structural.grid, [expectedGrid, expectedGrid, expectedGrid], `${label} structural grid`);
      finiteArray(structural.gridToWorld?.scale, 3, `${label} structural gridToWorld scale`);
      finiteArray(structural.gridToWorld?.translation, 3, `${label} structural gridToWorld translation`);
      finiteArray(structural.gridToWorld?.matrixColumnMajor, 16, `${label} structural gridToWorld matrix`);
      if (structural.gridToWorld?.identity !== 'boundary-sidecar-cell-center-index-to-volume-world-v0') throw new Error(`${label} structural gridToWorld identity is invalid`);
      if (typeof structural.captureId !== 'string' || !structural.captureId
        || structural.release?.released !== true || structural.release.captureId !== structural.captureId
        || structural.release.sameStateCaptureId !== structural.sameStateCaptureId) {
        throw new Error(`${label} structural release receipt is missing or mismatched`);
      }

      structureArtifact = await validateArtifact(manifestPath, structural.fields?.structure, `${label} structural structure`);
      metaArtifact = await validateArtifact(manifestPath, structural.fields?.meta, `${label} structural meta`);
      const expectedFieldBytes = expectedGrid ** 3 * 4 * 4;
      if (structureArtifact.bytes.length !== expectedFieldBytes || metaArtifact.bytes.length !== expectedFieldBytes) {
        throw new Error(`${label} structural field bytes must equal exact grid payload ${expectedFieldBytes}`);
      }
      if (structural.fields.structure.components !== 4 || structural.fields.meta.components !== 4) throw new Error(`${label} structural fields must contain four components`);
      exactArray(structural.fields.structure.channels, BOUNDARY_SPLAT_STRUCTURAL_STRUCTURE_CHANNELS, `${label} structural structure channel`);
      exactArray(structural.fields.meta.channels, BOUNDARY_SPLAT_STRUCTURAL_META_CHANNELS, `${label} structural meta channel`);
      validateFloat32Artifact(structureArtifact.bytes, `${label} structural structure data`);
      validateFloat32Artifact(metaArtifact.bytes, `${label} structural meta data`);
      structuralFrameCount += 1;
    }
    candidateCount += frame.candidates.count;
    frames.push({
      id: frame.id,
      candidatePath: candidateArtifact.path,
      targetPath: targetArtifact.path,
      flowDebugPath: flowDebugArtifact?.path || null,
      flowDebugAuthority: frame.flowDebug?.authority || null,
      structurePath: structureArtifact?.path || null,
      metaPath: metaArtifact?.path || null,
      structuralSupervisionIdentity: frame.structuralSupervision?.identity || null,
      controlConditioning,
      captureAdmission,
      requestedRaySteps: frame.target.requestedRaySteps ?? null,
      effectiveRaySteps: frame.target.effectiveRaySteps ?? null,
      renderScale: frame.target.renderScale ?? null,
      candidateCount: frame.candidates.count,
    });
  }

  return {
    schema: BOUNDARY_SPLAT_SUPERVISION_SCHEMA,
    corpusIdentity: `sha256:${sha256(manifestBytes)}`,
    manifestPath,
    frameCount: frames.length,
    candidateCount,
    structuralFrameCount,
    frames,
  };
}
