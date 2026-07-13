import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { BOUNDARY_SPLAT_ATTRIBUTE_FEATURES } from './boundary-splat-attribute-model.mjs';

export const BOUNDARY_SPLAT_SUPERVISION_SCHEMA = 'kaminos-boundary-splat-supervision-corpus-v0';
export const BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA = 'kaminos-boundary-splat-temporal-alignment-v0';
const TEMPORAL_ALIGNMENT_METHODS = new Set(['grid-cell-slot', 'world-position-stable-key']);

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

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
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

function validateTemporalAlignment(manifest, frameIds) {
  const alignment = manifest.temporalAlignment;
  if (alignment == null) return null;
  if (!alignment || typeof alignment !== 'object' || Array.isArray(alignment)) {
    throw new Error('temporal alignment must be an object');
  }
  if (alignment.schema !== BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA) {
    throw new Error(`temporal alignment schema must be ${BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA}`);
  }
  if (!TEMPORAL_ALIGNMENT_METHODS.has(alignment.alignmentMethod)) {
    throw new Error('temporal alignment method must be grid-cell-slot or world-position-stable-key; nearest-neighbor matching is not stable identity evidence');
  }
  if (alignment.identityKey !== alignment.alignmentMethod) {
    throw new Error('temporal alignment identityKey must match the stable alignment method');
  }
  if (!Array.isArray(alignment.offsetSteps) || alignment.offsetSteps.length === 0) {
    throw new Error('temporal alignment must declare nonzero offset steps');
  }
  const offsetSteps = [...new Set(alignment.offsetSteps)];
  if (offsetSteps.length !== alignment.offsetSteps.length) {
    throw new Error('temporal alignment offset steps must be unique');
  }
  for (const offset of offsetSteps) {
    if (!Number.isInteger(offset) || offset === 0) throw new Error('temporal alignment offset steps must be nonzero integers');
  }
  const positiveOffsetCount = offsetSteps.filter(offset => offset > 0).length;
  const negativeOffsetCount = offsetSteps.filter(offset => offset < 0).length;
  if (positiveOffsetCount < 3 || negativeOffsetCount < 3) {
    throw new Error('temporal alignment must include at least three positive and three negative nonzero offsets');
  }
  const easyOffsetCount = offsetSteps.filter(offset => Math.abs(offset) <= 2).length;
  const hardOffsetCount = offsetSteps.filter(offset => Math.abs(offset) >= 4).length;
  if (easyOffsetCount === 0 || hardOffsetCount === 0) {
    throw new Error('temporal alignment must include both easy and harder offset ranges');
  }
  const semantics = alignment.supportSemantics;
  if (!semantics || typeof semantics !== 'object' || Array.isArray(semantics)) {
    throw new Error('temporal alignment must declare support semantics');
  }
  for (const key of ['matched', 'birth', 'death']) {
    if (typeof semantics[key] !== 'string' || semantics[key].trim().length === 0) {
      throw new Error(`temporal alignment supportSemantics.${key} must be nonblank`);
    }
  }
  if (!Array.isArray(alignment.pairs) || alignment.pairs.length === 0) {
    throw new Error('temporal alignment must contain offset pairs');
  }
  const declaredOffsets = new Set(offsetSteps);
  const coveredOffsets = new Set();
  let totalMatchedSlots = 0;
  let totalBirths = 0;
  let totalDeaths = 0;
  let totalStableSupport = 0;
  for (const [index, pair] of alignment.pairs.entries()) {
    const label = `temporal alignment pair ${index}`;
    if (!pair || typeof pair !== 'object' || Array.isArray(pair)) throw new Error(`${label} must be an object`);
    if (typeof pair.sourceFrameId !== 'string' || !frameIds.has(pair.sourceFrameId)) throw new Error(`${label} sourceFrameId must reference a corpus frame`);
    if (typeof pair.targetFrameId !== 'string' || !frameIds.has(pair.targetFrameId)) throw new Error(`${label} targetFrameId must reference a corpus frame`);
    if (pair.sourceFrameId === pair.targetFrameId) throw new Error(`${label} must compare distinct source and target frames`);
    if (!Number.isInteger(pair.offsetSteps) || pair.offsetSteps === 0) throw new Error(`${label} offsetSteps must be a nonzero integer`);
    if (!declaredOffsets.has(pair.offsetSteps)) throw new Error(`${label} offsetSteps must be declared in temporalAlignment.offsetSteps`);
    positiveInteger(pair.sourceCount, `${label} sourceCount`);
    positiveInteger(pair.targetCount, `${label} targetCount`);
    nonNegativeInteger(pair.matchedSlots, `${label} matchedSlots`);
    nonNegativeInteger(pair.births, `${label} births`);
    nonNegativeInteger(pair.deaths, `${label} deaths`);
    nonNegativeInteger(pair.stableSupportCount, `${label} stableSupportCount`);
    if (pair.matchedSlots > Math.min(pair.sourceCount, pair.targetCount)) {
      throw new Error(`${label} matchedSlots cannot exceed source/target counts`);
    }
    if (pair.matchedSlots + pair.births > pair.targetCount) {
      throw new Error(`${label} births plus matchedSlots cannot exceed targetCount`);
    }
    if (pair.matchedSlots + pair.deaths > pair.sourceCount) {
      throw new Error(`${label} deaths plus matchedSlots cannot exceed sourceCount`);
    }
    if (pair.stableSupportCount > pair.matchedSlots) {
      throw new Error(`${label} stableSupportCount cannot exceed matchedSlots`);
    }
    coveredOffsets.add(pair.offsetSteps);
    totalMatchedSlots += pair.matchedSlots;
    totalBirths += pair.births;
    totalDeaths += pair.deaths;
    totalStableSupport += pair.stableSupportCount;
  }
  for (const offset of declaredOffsets) {
    if (!coveredOffsets.has(offset)) throw new Error(`temporal alignment offset ${offset} has no pair evidence`);
  }
  return {
    schema: BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA,
    identityKey: alignment.identityKey,
    alignmentMethod: alignment.alignmentMethod,
    offsetSteps,
    pairCount: alignment.pairs.length,
    positiveOffsetCount,
    negativeOffsetCount,
    easyOffsetCount,
    hardOffsetCount,
    totalMatchedSlots,
    totalBirths,
    totalDeaths,
    totalStableSupport,
  };
}

export async function validateBoundarySplatSupervisionCorpus(manifestFile) {
  const manifestPath = resolve(manifestFile);
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.length === 0) throw new Error('corpus manifest is blank');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schema !== BOUNDARY_SPLAT_SUPERVISION_SCHEMA) throw new Error(`corpus schema must be ${BOUNDARY_SPLAT_SUPERVISION_SCHEMA}`);
  if (manifest.authority !== 'live-simulator-frozen-state-candidate-raymarch-v0') throw new Error('corpus authority must preserve live frozen simulator state');
  exactArray(manifest.featureOrder, BOUNDARY_SPLAT_ATTRIBUTE_FEATURES, 'feature');
  if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) throw new Error('corpus must contain at least one frame');

  let candidateCount = 0;
  const frames = [];
  const frameIds = new Set();
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
    finiteArray(frame.camera?.viewport, 2, `${label} camera viewport`);
    if (frame.camera.viewport.some(value => value <= 0)) throw new Error(`${label} camera viewport must be positive`);

    const candidateArtifact = await validateArtifact(manifestPath, frame.candidates, `${label} candidate`);
    if (frame.candidates.dtype !== 'float32-le' || frame.candidates.strideFloats !== 19 || !Number.isInteger(frame.candidates.count) || frame.candidates.count <= 0) {
      throw new Error(`${label} candidate layout must be positive-count float32-le with stride 19`);
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
    candidateCount += frame.candidates.count;
    frameIds.add(frame.id);
    frames.push({
      id: frame.id,
      candidatePath: candidateArtifact.path,
      targetPath: targetArtifact.path,
      candidateCount: frame.candidates.count,
    });
  }
  const temporalAlignment = validateTemporalAlignment(manifest, frameIds);

  return {
    schema: BOUNDARY_SPLAT_SUPERVISION_SCHEMA,
    corpusIdentity: `sha256:${sha256(manifestBytes)}`,
    manifestPath,
    frameCount: frames.length,
    candidateCount,
    frames,
    temporalAlignment,
  };
}
