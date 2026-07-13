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

export async function validateBoundarySplatSupervisionCorpus(manifestFile) {
  const manifestPath = resolve(manifestFile);
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.length === 0) throw new Error('corpus manifest is blank');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== BOUNDARY_SPLAT_SUPERVISION_SCHEMA) throw new Error(`corpus schema must be ${BOUNDARY_SPLAT_SUPERVISION_SCHEMA}`);
  if (manifest.authority !== 'live-simulator-frozen-state-candidate-raymarch-v0') throw new Error('corpus authority must preserve live frozen simulator state');
  exactArray(manifest.candidateOrder, BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER, 'candidate');
  exactArray(manifest.featureOrder, BOUNDARY_SPLAT_ATTRIBUTE_FEATURES, 'feature');
  if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) throw new Error('corpus must contain at least one frame');

  let candidateCount = 0;
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
    candidateCount += frame.candidates.count;
    frames.push({
      id: frame.id,
      candidatePath: candidateArtifact.path,
      targetPath: targetArtifact.path,
      flowDebugPath: flowDebugArtifact?.path || null,
      flowDebugAuthority: frame.flowDebug?.authority || null,
      candidateCount: frame.candidates.count,
    });
  }

  return {
    schema: BOUNDARY_SPLAT_SUPERVISION_SCHEMA,
    corpusIdentity: `sha256:${sha256(manifestBytes)}`,
    manifestPath,
    frameCount: frames.length,
    candidateCount,
    frames,
  };
}
