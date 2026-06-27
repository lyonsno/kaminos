import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE,
  adaptGeneratedPoseTemporalToTrack,
  buildGeneratedPoseTemporalHarness,
  interpolateGeneratedPoseTemporalSample,
  sampleGeneratedPoseTemporalMotion,
  sampleMotionTrack,
} from '../motion-core.js';

const root = new URL('..', import.meta.url).pathname;
const extractorPath = join(root, 'generated-pose-features.mjs');
const indexPath = join(root, 'index.html');
const witnessPath = join(root, 'motion-witness.mjs');

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

assert.ok(existsSync(extractorPath), 'generated-pose-features.mjs must emit temporal samples');
assert.ok(existsSync(indexPath), 'index.html must host generated pose temporal route');
assert.ok(existsSync(witnessPath), 'motion-witness.mjs must validate generated pose temporal route');

const extractor = readFileSync(extractorPath, 'utf8');
const index = readFileSync(indexPath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');

assert.match(extractor, /--temporal-samples/, 'feature extractor accepts a temporal sample budget');
assert.match(extractor, /temporalSamples/, 'feature report preserves bounded temporal samples');
assert.match(extractor, /phaseLabel/, 'temporal samples expose heuristic phase labels');
assert.match(extractor, /bowCompression/, 'temporal samples expose bow/compression evidence');
assert.match(extractor, /sourceFrameStride/, 'feature report records temporal downsample stride');

assert.equal(DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE.schema, 'kaminos.generated-pose-temporal.v0');
assert.equal(DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE.sourceFormat, 'kimodo-soma77-explicit-joints');
assert.match(DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE.sourceRoute, /03_a_person_performs_an_exaggerated_theatrical_bow_sw\.npz/);
assert.ok(DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE.temporalSamples.length >= 16, 'fixture preserves a useful temporal sample track');
assert.ok(DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE.temporalSamples.some(sample => sample.phaseLabel === 'compress'), 'fixture exposes bow compression phase');
assert.ok(DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE.temporalSamples.some(sample => sample.phaseLabel === 'release'), 'fixture exposes bow release phase');

const track = adaptGeneratedPoseTemporalToTrack(DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE);
assert.equal(track.schema, 'kaminos.motion-track.v0');
assert.equal(track.id, 'kimodo_theatrical_bow_temporal_v0');
assert.equal(track.sourceKind, 'generated-pose-temporal');
assert.equal(track.sourceModel, 'Kimodo');
assert.equal(track.sourceStatus, 'fixture');
assert.ok(track.duration > 5.8 && track.duration < 6.1, 'track preserves source duration');
assert.ok(track.rawFrameCount === 180, 'track preserves source frame count');
assert.ok(track.extractionAssumptions.some(line => line.includes('actual SOMA77 joints')), 'track names actual-joint temporal source');

const start = sampleMotionTrack(track, 0);
const compress = sampleMotionTrack(track, 2.7);
const release = sampleMotionTrack(track, 5.1);
assert.ok(compress.effort > start.effort, 'bow compression raises temporal effort');
assert.ok(release.phase === 'release' || release.phase === 'recover', 'release/recover phase survives sampling');
assert.ok(compress.headRootSeparation !== start.headRootSeparation, 'head/root relationship changes over time');

const firstTemporal = track.temporalSamples[0];
const secondTemporal = track.temporalSamples[1];
const midpointTime = (firstTemporal.time + secondTemporal.time) / 2;
const midpointTemporal = interpolateGeneratedPoseTemporalSample(track, midpointTime);
assert.equal(midpointTemporal.schema, 'kaminos.generated-pose-temporal-sample.v0');
assert.equal(midpointTemporal.bracket.fromFrame, firstTemporal.frame);
assert.equal(midpointTemporal.bracket.toFrame, secondTemporal.frame);
assert.ok(midpointTemporal.interpolation > 0 && midpointTemporal.interpolation < 1, 'midpoint temporal sample records between-frame interpolation');
assert.notEqual(midpointTemporal.sourceFrame, firstTemporal.frame, 'interpolated temporal sample must not snap to the previous source frame');
assert.notEqual(midpointTemporal.sourceFrame, secondTemporal.frame, 'interpolated temporal sample must not snap to the next source frame');
assert.ok(
  Math.abs(midpointTemporal.bowCompression - firstTemporal.bowCompression) > 1e-4
    && Math.abs(midpointTemporal.bowCompression - secondTemporal.bowCompression) > 1e-4,
  'bow compression is interpolated between temporal source samples instead of nearest-sample snapped',
);
assert.ok(
  Math.abs(midpointTemporal.chestRoot[0] - firstTemporal.chestRoot[0]) > 1e-4
    && Math.abs(midpointTemporal.chestRoot[0] - secondTemporal.chestRoot[0]) > 1e-4,
  'chest/root roll evidence is interpolated between temporal source samples',
);
assert.equal(midpointTemporal.sampler, 'catmull-rom-continuous-velocity', 'temporal interpolation must not ease to a stop at each source sample');

const interiorTemporal = track.temporalSamples.find(sample => sample.frame === 63);
const dt = 1 / 120;
const beforeInterior = interpolateGeneratedPoseTemporalSample(track, interiorTemporal.time - dt);
const atInterior = interpolateGeneratedPoseTemporalSample(track, interiorTemporal.time);
const afterInterior = interpolateGeneratedPoseTemporalSample(track, interiorTemporal.time + dt);
assert.ok(
  Math.abs(atInterior.sourceFrame - beforeInterior.sourceFrame) > 0.12
    && Math.abs(afterInterior.sourceFrame - atInterior.sourceFrame) > 0.12,
  'continuous temporal sampler keeps source-frame progress through interior sample times instead of pausing on them',
);
assert.ok(
  distance(beforeInterior.head, atInterior.head) > 0.001
    && distance(atInterior.head, afterInterior.head) > 0.001,
  'continuous temporal sampler keeps visible head/attention motion through interior sample times',
);
const visibleTemporalMotion = sampleGeneratedPoseTemporalMotion(track, interiorTemporal.time + dt);
assert.equal(visibleTemporalMotion.sampler, 'catmull-rom-continuous-velocity', 'route-facing temporal motion sample reports continuous sampler identity');
assert.equal(visibleTemporalMotion.temporalSample.schema, 'kaminos.generated-pose-temporal-sample.v0', 'route-facing temporal motion includes the source temporal interpolation evidence');

const harness = buildGeneratedPoseTemporalHarness({
  generatedInput: DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE,
  fps: 12,
  filmstripFrames: 7,
});
assert.equal(harness.schema, 'kaminos.generated-pose-temporal-harness.v0');
assert.equal(harness.route, 'procedural-orb-motion-grammar-v0');
assert.equal(harness.sourceRoute, DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE.sourceRoute);
assert.ok(harness.metrics.maxBowCompression > 0.25, 'temporal harness preserves bow compression metric');
assert.ok(harness.metrics.phaseLabels.includes('compress'), 'temporal harness preserves compress phase label');
assert.ok(harness.metrics.phaseLabels.includes('release'), 'temporal harness preserves release phase label');
assert.ok(harness.filmstrip.length === 7, 'temporal harness exposes filmstrip frames');

assert.match(index, /DEFAULT_KIMODO_BOW_TEMPORAL_POSE_FIXTURE/, 'browser imports Kimodo bow temporal fixture');
assert.match(index, /buildGeneratedPoseTemporalHarness/, 'browser imports temporal harness builder');
assert.match(index, /kaminos_generated_pose_temporal=1/, 'browser declares generated pose temporal route');
assert.match(index, /motion-temporal-enable/, 'motion tab exposes temporal route button');
assert.match(index, /createGeneratedPoseTemporalScene/, 'browser creates temporal route scene');
assert.match(index, /updateGeneratedPoseTemporalFrame/, 'render loop advances temporal route');
assert.match(index, /window\.kaminosGeneratedPoseTemporalDebugState/, 'browser exposes temporal route debug state');
assert.doesNotMatch(index, /nearestTemporalSample/, 'browser temporal route must not nearest-sample runtime compression evidence');
assert.match(index, /interpolateGeneratedPoseTemporalSample/, 'browser temporal route samples temporal evidence continuously');
assert.match(index, /sampleGeneratedPoseTemporalMotion/, 'browser temporal route drives root/head motion from the continuous temporal sampler');
assert.doesNotMatch(index, /sampleMotionTrack\(state\.track, localTime/, 'browser temporal route must not drive visible temporal motion through smoothstep track sampling');

assert.match(witness, /isGeneratedPoseTemporalRoute/, 'motion witness detects generated pose temporal route');
assert.match(witness, /buildGeneratedPoseTemporalHarness/, 'motion witness builds temporal filmstrip');
assert.match(witness, /window\.kaminosGeneratedPoseTemporalDebugState/, 'motion witness reads temporal browser debug state');
assert.match(witness, /generatedPoseTemporalHarness/, 'motion witness reports temporal harness evidence');
assert.match(witness, /maxBowCompression/, 'motion witness validates temporal bow compression');
assert.match(witness, /sourceInterpolation/, 'motion witness rejects temporal routes that do not expose between-source-frame interpolation');
assert.match(witness, /sourceBracket/, 'motion witness records the temporal source-frame bracket used by the live actor');
assert.match(witness, /catmull-rom-continuous-velocity/, 'motion witness validates continuous-velocity temporal sampler identity');
