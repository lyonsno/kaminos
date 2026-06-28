import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildGeneratedPoseTemporalCliplets,
  buildGeneratedPoseClipletPlayback,
  sampleGeneratedPoseClipletPlayback,
} from '../motion-core.js';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

function poseSample(frame, phaseLabel, rootZ, compression = 0.1) {
  return {
    frame,
    sourceFrame: frame,
    time: Number((frame / 20).toFixed(5)),
    phaseLabel,
    root: [0, 0, rootZ],
    head: [0, 1.5 - compression * 0.1, rootZ + 0.08],
    chest: [0, 1.1 - compression * 0.06, rootZ + 0.03],
    leftHand: [-0.24, 1.0, rootZ + 0.02],
    rightHand: [0.24, 1.0, rootZ + 0.02],
    leftFoot: [-0.16, 0.05, rootZ - 0.03],
    rightFoot: [0.16, 0.05, rootZ - 0.03],
    headRoot: [0, 1.5 - compression * 0.1, 0.08],
    chestRoot: [0, 1.1 - compression * 0.06, 0.03],
    handSpan: 0.48,
    stanceWidth: 0.32,
    bboxVolume: 1.1,
    bowCompression: compression,
  };
}

const temporalSamples = [
  poseSample(0, 'enter', 0.0, 0.08),
  poseSample(1, 'enter', 0.08, 0.08),
  poseSample(2, 'commit', 0.18, 0.12),
  poseSample(3, 'commit', 0.32, 0.12),
  poseSample(4, 'brake', 0.35, 0.82),
  poseSample(5, 'brake', 0.34, 0.86),
  poseSample(6, 'escape', 0.18, 0.42),
  poseSample(7, 'escape', -0.02, 0.28),
  poseSample(8, 'settle', -0.04, 0.14),
  poseSample(9, 'settle', -0.04, 0.12),
];

const generatedClip = {
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'synthetic_cliplet_playback_source',
  label: 'Synthetic Cliplet Playback Source',
  intent: 'a man stops short then escapes',
  sourceKind: 'motion-panel-generated-pose-temporal',
  sourceStatus: 'test-fixture',
  sourceModel: 'contract-synthetic',
  sourceRoute: 'tests/generated-motion-cliplet-playback-contracts.mjs',
  sourceFrameStride: 1,
  rawFrameCount: temporalSamples.length,
  fps: 20,
  duration: temporalSamples.at(-1).time,
  temporalSamples,
};

const cliplets = buildGeneratedPoseTemporalCliplets(generatedClip);
assert.ok(cliplets.rawSegments.length >= 4, 'fixture preserves multiple raw source cliplets');
assert.ok(cliplets.segments.length >= 2, 'fixture produces multiple phrase cliplets for playback');
assert.ok(cliplets.segments.length <= cliplets.rawSegments.length, 'phrase cliplets coalesce raw source crumbs');

const brake = cliplets.segments.find(segment => segment.labelGuess.includes('brake'));
const escape = cliplets.segments.find(segment => segment.labelGuess.includes('escape'));
assert.ok(brake, 'fixture includes a brake cliplet');
assert.ok(escape, 'fixture includes an escape cliplet');

const playback = buildGeneratedPoseClipletPlayback({
  cliplets,
  segmentIds: [brake.id, escape.id],
  mode: 'splice',
});

assert.equal(playback.schema, 'kaminos.generated-motion-cliplet-playback.v0');
assert.equal(playback.sourceClipId, generatedClip.id);
assert.equal(playback.mode, 'splice');
assert.equal(playback.segments.length, 2);
assert.equal(playback.segments[0].sourceSegmentId, brake.id);
assert.equal(playback.segments[1].sourceSegmentId, escape.id);
assert.equal(playback.segments[0].startSourceFrame, brake.startSourceFrame);
assert.equal(playback.segments[1].endSourceFrame, escape.endSourceFrame);
assert.ok(playback.duration > 0, 'playback timeline exposes positive duration');
assert.ok(playback.sourceRanges.every(range => range.startSourceFrame <= range.endSourceFrame), 'playback preserves ordered source-frame ranges');

const first = sampleGeneratedPoseClipletPlayback(generatedClip, playback, 0);
assert.equal(first.playback.schema, 'kaminos.generated-motion-cliplet-playback-sample.v0');
assert.equal(first.playback.segmentId, brake.id);
assert.ok(first.playback.sourceFrame >= brake.startSourceFrame && first.playback.sourceFrame <= brake.endSourceFrame);
assert.equal(first.motionSample.temporalSample.sourceFrame, first.playback.sourceFrame);

const second = sampleGeneratedPoseClipletPlayback(generatedClip, playback, playback.segments[0].duration + 0.001);
assert.equal(second.playback.segmentId, escape.id);
assert.ok(second.playback.sourceFrame >= escape.startSourceFrame && second.playback.sourceFrame <= escape.endSourceFrame);

const looped = sampleGeneratedPoseClipletPlayback(generatedClip, playback, playback.duration + 0.001);
assert.equal(looped.playback.segmentId, brake.id, 'cliplet playback loops without escaping into full-source time');

assert.match(index, /id="motion-panel-cliplet-playback"/, 'Motion panel exposes a source cliplet playback selector');
assert.match(index, /function renderMotionPanelClipletPlaybackOptions/, 'browser renders cliplet playback choices from source cliplets');
assert.match(index, /motionPanelClipletPlaybackFromInputs/, 'browser builds playback timeline from Motion panel inputs');
assert.match(index, /sampleGeneratedPoseClipletPlayback/, 'browser samples generated temporal motion through cliplet playback');
assert.match(index, /clipletPlayback/, 'browser debug/export evidence exposes active cliplet playback state');

assert.match(liveWitness, /clipletPlayback/, 'live witness records cliplet playback evidence');
assert.match(liveWitness, /--cliplet-playback/, 'live witness can drive the cliplet playback selector');
