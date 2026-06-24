import assert from 'node:assert/strict';

import {
  DEFAULT_MOTION_TRACK_FIXTURE,
  MOTION_TRACK_SCHEMA,
  buildMotionTrackHarness,
  normalizeMotionTrack,
  sampleMotionTrack,
  simulateMotionTrack,
} from '../motion-core.js';

assert.equal(MOTION_TRACK_SCHEMA, 'kaminos.motion-track.v0');

const track = normalizeMotionTrack(DEFAULT_MOTION_TRACK_FIXTURE);
assert.equal(track.schema, MOTION_TRACK_SCHEMA);
assert.equal(track.id, 'fixture_cog_head_decision_v0');
assert.equal(track.sourceKind, 'fixture');
assert.equal(track.fps, 30);
assert.equal(track.units, 'meters');
assert.deepEqual(track.upAxis, [0, 1, 0]);
assert.deepEqual(track.forwardAxis, [0, 0, 1]);
assert.ok(track.tracks.root.length >= 6, 'fixture exposes center-of-gravity/root samples');
assert.ok(track.tracks.head.length >= 6, 'fixture exposes head/attention samples');
assert.ok(track.tracks.phase.length >= 4, 'fixture exposes phase markers');
assert.ok(track.tracks.effort.length >= 4, 'fixture exposes effort samples');

const early = sampleMotionTrack(track, 0.8);
const notice = sampleMotionTrack(track, 1.55);
const commit = sampleMotionTrack(track, 3.1);
assert.equal(early.schema, 'kaminos.motion-track-sample.v0');
assert.equal(early.trackId, track.id);
assert.ok(early.headRootSeparation > 0.25, 'head and CoG are separate signals');
assert.ok(notice.attention[2] > notice.root[2] + 0.5, 'attention can look ahead of mass');
assert.ok(commit.root[2] > notice.root[2] + 0.5, 'root/CoG can commit after attention leads');
assert.ok(commit.effort > early.effort, 'track effort can accent commitment');
assert.ok(Math.abs(Math.hypot(...commit.facing) - 1) < 0.001, 'derived facing is normalized');

const rootOnly = simulateMotionTrack(track, { duration: track.duration, fps: 12, mode: 'root-only' });
const full = simulateMotionTrack(track, { duration: track.duration, fps: 12, mode: 'root+head' });
assert.equal(full.schema, 'kaminos.motion-track-simulation.v0');
assert.equal(full.mode, 'root+head');
assert.equal(full.frames.length, Math.floor(track.duration * 12) + 1);
assert.ok(full.metrics.rootTravel > 1.2, 'track simulation measures root travel');
assert.ok(full.metrics.phaseChanges >= 4, 'track simulation preserves phase changes');
assert.ok(full.metrics.attentionLeadDistance > rootOnly.metrics.attentionLeadDistance + 0.2, 'head track adds attention lead beyond root-only playback');
assert.ok(full.metrics.maxHeadRootSeparation > rootOnly.metrics.maxHeadRootSeparation + 0.2, 'head track adds readable separation from CoG');

const harness = buildMotionTrackHarness({ duration: track.duration, fps: 12 });
assert.equal(harness.schema, 'kaminos.motion-track-harness.v0');
assert.equal(harness.route, 'procedural-orb-motion-grammar-v0');
assert.equal(harness.track.schema, MOTION_TRACK_SCHEMA);
assert.deepEqual(
  harness.variants.map(variant => variant.id),
  ['phrase_baseline', 'track_root_only', 'track_root_head'],
  'track harness compares phrase baseline, root-only track, and root+head track',
);
assert.ok(harness.variants.find(variant => variant.id === 'track_root_head').metrics.attentionLeadDistance > harness.variants.find(variant => variant.id === 'track_root_only').metrics.attentionLeadDistance, 'harness records root+head attention advantage');
assert.ok(harness.filmstrip.length >= 7, 'track harness exposes filmstrip-ready frames');
