import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const helperUrl = new URL('../boundary-splat-feature-capture.mjs', import.meta.url);
const coreUrl = new URL('../volume-core.js', import.meta.url);
const helperSource = await readFile(helperUrl, 'utf8');
const core = await readFile(coreUrl, 'utf8');

assert.match(
  helperSource,
  /export const BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_IDENTITY\s*=\s*['"]boundary-splat-fixed-candidate-supervision-v0['"]/,
  'supervision candidate producer declares exact identity',
);
assert.match(
  helperSource,
  /export const BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS\s*=\s*19/,
  'supervision candidate producer declares position plus sixteen features',
);
assert.match(
  helperSource,
  /export function packBoundarySplatSupervisionCandidates/,
  'supervision candidate producer exports a direct packer',
);

const {
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_IDENTITY,
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER,
  BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS,
  packBoundarySplatSupervisionCandidates,
} = await import(helperUrl);

assert.equal(BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_IDENTITY, 'boundary-splat-fixed-candidate-supervision-v0');
assert.equal(BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_STRIDE_FLOATS, 19);
assert.deepEqual(BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER.slice(0, 3), ['position.x', 'position.y', 'position.z']);
assert.equal(BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER.length, 19);

const candidateValues = new Float32Array([
  1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  4, 5, 6, 20, 21, 22, 23, 24, 25, 26, 27, 28,
]);
const featureValues = new Float32Array(32).map((_, index) => 100 + index);
const packed = packBoundarySplatSupervisionCandidates(candidateValues, featureValues, 2, 131072);
assert.equal(packed.identity, BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_IDENTITY);
assert.equal(packed.rowCount, 2);
assert.equal(packed.strideFloats, 19);
assert.equal(packed.packedByteLength, 2 * 19 * 4);
const packedBytes = Buffer.from(packed.packedFloat32Base64, 'base64');
const packedValues = new Float32Array(packedBytes.buffer, packedBytes.byteOffset, 38);
assert.deepEqual(Array.from(packedValues.slice(0, 3)), [1, 2, 3]);
assert.deepEqual(Array.from(packedValues.slice(3, 19)), Array.from(featureValues.slice(0, 16)));
assert.deepEqual(Array.from(packedValues.slice(19, 22)), [4, 5, 6]);
assert.deepEqual(Array.from(packedValues.slice(22, 38)), Array.from(featureValues.slice(16, 32)));
assert.throws(
  () => packBoundarySplatSupervisionCandidates(candidateValues.slice(0, 12), featureValues, 2, 131072),
  /candidate values must contain exactly 24/,
);
const nonFiniteFeatures = featureValues.slice();
nonFiniteFeatures[7] = Number.NaN;
assert.throws(
  () => packBoundarySplatSupervisionCandidates(candidateValues, nonFiniteFeatures, 2, 131072),
  /non-finite/,
);

assert.match(core, /async function sampleBoundarySplatSupervisionCapture\(instanceCount\)/, 'runtime owns a paired candidate-feature readback');
assert.match(core, /copyBufferToBuffer\(boundarySplatBuffer[\s\S]*copyBufferToBuffer\(boundarySplatFeatureBuffer/, 'readback copies positions and features from the same accepted candidate cohort');
assert.match(core, /packBoundarySplatSupervisionCandidates\(candidateValues, featureValues, instanceCount, boundarySplatCapacity\)/, 'runtime packs the exact accepted row count without a hidden cap');
assert.match(core, /async function captureBoundarySplatSupervisionCandidates\(options = \{\}\)/, 'runtime exposes candidate-only supervision capture');
assert.match(core, /captureBoundarySplatSupervisionCandidates[\s\S]*advanceSim:\s*false/, 'candidate capture renders without advancing simulation');
assert.match(core, /captureBoundarySplatSupervisionCandidates[\s\S]*boundarySplatMode:\s*['"]analytic['"][\s\S]*boundarySplatFeatureCapture:\s*true/, 'candidate capture requests analytic candidates and full feature rows');
assert.match(core, /captureBoundarySplatSupervisionCandidates[\s\S]*setVolumePresentationMode\(['"]beauty['"]\)/, 'candidate capture requests a supported explicit presentation mode without fallback');
assert.match(
  core,
  /boundarySplatSupervisionCaptureActive\s*=\s*true;\s*try\s*\{\s*cancelAnimationFrame\(raf\);[\s\S]*device\.queue\?\.onSubmittedWorkDone/,
  'candidate capture wraps the initial queue drain in the restoration finally block',
);
assert.match(core, /captureBoundarySplatSupervisionCandidates[\s\S]*sameStateCaptureId[\s\S]*simStepCount[\s\S]*camera/, 'candidate capture reports frozen-state and camera identity');
assert.match(
  core,
  /boundarySplatCapacity\s*<\s*candidateSample\.boundarySplatCandidateCount[\s\S]*growBoundarySplatCapacity\(candidateSample\.boundarySplatCandidateCount\)/,
  'overflow recovery accepts telemetry-owned growth and only requests growth while current capacity is insufficient',
);
assert.doesNotMatch(core, /captureBoundarySplatSupervisionCandidates[\s\S]*requestedRaySteps/, 'candidate-only capture does not import an obsolete raymarch teacher');
assert.match(core, /\bcaptureBoundarySplatSupervisionCandidates,/, 'candidate-only capture is exposed through the prototype API');

console.log('boundary splat supervision candidate capture contracts passed');
