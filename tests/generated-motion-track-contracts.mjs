import assert from 'node:assert/strict';

import {
  DEFAULT_DIP_WAVE_GENERATED_MOTION_FIXTURE,
  MOTION_TRACK_SCHEMA,
  adaptGeneratedJointMotionToTrack,
  buildGeneratedMotionTrackHarness,
  sampleMotionTrack,
  simulateMotionTrack,
} from '../motion-core.js';

const track = adaptGeneratedJointMotionToTrack(DEFAULT_DIP_WAVE_GENERATED_MOTION_FIXTURE);

assert.equal(track.schema, MOTION_TRACK_SCHEMA);
assert.equal(track.id, 'dip_wave_generated_fixture_v0');
assert.equal(track.sourceKind, 'generated-fixture');
assert.equal(track.sourceStatus, 'fixture');
assert.equal(track.sourceModel, 'DiP');
assert.match(track.sourceRoute, /motion-diffusion-model\/save\/DiP_no-target_10steps_context20_predict40/);
assert.equal(track.prompt, 'A person walks forward and waves their hand.');
assert.equal(track.rawFrameCount, 120);
assert.equal(track.fps, 20);
assert.equal(track.duration, 5.95);
assert.deepEqual(track.jointMapping, {
  root: 0,
  head: 15,
  leftWrist: 20,
  rightWrist: 21,
});
assert.deepEqual(track.extractionAssumptions, [
  'input is generated HumanML/T2M absolute xyz joints shaped joints x xyz x frames',
  'pelvis joint 0 drives root/CoG',
  'head joint 15 drives attention/head',
  'wrist height delta drives wave-effort envelope',
  'phase labels are heuristic and must not claim source-authored semantics',
]);

const start = sampleMotionTrack(track, 0);
const wave = sampleMotionTrack(track, 0.75);
const report = sampleMotionTrack(track, 4.5);
assert.ok(wave.root[2] > start.root[2] + 0.3, 'generated root enters along stage depth');
assert.ok(report.root[2] > start.root[2] + 3.0, 'generated root preserves large forward travel');
assert.ok(wave.effort > start.effort, 'wave wrist motion raises effort above entry');
assert.ok(report.phase === 'reporting' || report.phase === 'wave', 'generated phase labels expose wave/reporting semantics');

const simulation = simulateMotionTrack(track, { duration: track.duration, fps: 20, mode: 'mass-attention' });
assert.ok(simulation.metrics.rootTravel > 4.5, 'generated simulation preserves root travel');
assert.ok(simulation.metrics.maxEffort > 0.45, 'generated simulation preserves wave effort');
assert.ok(simulation.metrics.phaseChanges >= 3, 'generated simulation preserves heuristic phase changes');
assert.ok(simulation.metrics.maxHeadRootSeparation > 0.5, 'generated simulation preserves head/root separation');

const harness = buildGeneratedMotionTrackHarness({ generatedInput: DEFAULT_DIP_WAVE_GENERATED_MOTION_FIXTURE, fps: 12 });
assert.equal(harness.schema, 'kaminos.generated-motion-track-harness.v0');
assert.equal(harness.route, 'procedural-orb-motion-grammar-v0');
assert.equal(harness.track.id, 'dip_wave_generated_fixture_v0');
assert.equal(harness.sourceStatus, 'fixture');
assert.deepEqual(
  harness.variants.map(variant => variant.id),
  ['authored_mass_attention', 'generated_dip_wave'],
);
assert.equal(harness.variants.find(variant => variant.id === 'generated_dip_wave').attentionMode, 'mass-attention');
assert.ok(harness.variants.find(variant => variant.id === 'generated_dip_wave').metrics.rootTravel > harness.variants.find(variant => variant.id === 'authored_mass_attention').metrics.rootTravel, 'generated fixture keeps its larger stage entrance travel');
assert.ok(harness.filmstrip.length >= 7, 'generated harness exposes filmstrip-ready frames');
