import assert from 'node:assert/strict';

import {
  DEFAULT_MOTION_ACTORS,
  DEFAULT_MOTION_CLIPS,
  MOTION_CLIP_SCHEMA,
  MOTION_ROUTE_IDENTITY,
  buildMotionActorFixture,
  buildMotionWitnessTimeline,
  motionClipById,
  normalizeMotionClip,
  resolveMotionActorClips,
  sampleMotionClip,
  simulateMotionActors,
} from '../motion-core.js';

assert.equal(MOTION_CLIP_SCHEMA, 'kaminos.motion-clip.v0');
assert.equal(MOTION_ROUTE_IDENTITY, 'procedural-orb-motion-grammar-v0');
assert.ok(DEFAULT_MOTION_CLIPS.length >= 5, 'motion grammar ships at least five procedural clips');
assert.deepEqual(
  DEFAULT_MOTION_CLIPS.map(clip => clip.id),
  [
    'idle_breathe_watch',
    'approach_curious',
    'stalk_bad_intent',
    'flinch_retreat',
    'orbit_inspect',
  ],
  'default clip pack keeps the expected agency vocabulary stable',
);

for (const clip of DEFAULT_MOTION_CLIPS) {
  const normalized = normalizeMotionClip(clip);
  assert.equal(normalized.schema, MOTION_CLIP_SCHEMA, `${clip.id} preserves motion clip schema`);
  assert.ok(normalized.duration > 0, `${clip.id} has positive duration`);
  assert.ok(normalized.intent, `${clip.id} carries intent text`);
  assert.ok(normalized.samples.length >= 3, `${clip.id} has enough samples to interpolate`);
  assert.equal(normalized.samples[0].t, 0, `${clip.id} starts at t=0`);
  assert.equal(normalized.samples.at(-1).t, normalized.duration, `${clip.id} ends exactly at duration`);
  for (const sample of normalized.samples) {
    assert.equal(sample.root.length, 3, `${clip.id} root samples are vec3`);
    assert.equal(sample.facing.length, 3, `${clip.id} facing samples are vec3`);
    assert.equal(sample.attention.length, 3, `${clip.id} attention samples are vec3`);
    assert.ok(Number.isFinite(sample.effort), `${clip.id} effort is finite`);
  }
}

const stalk = motionClipById('stalk_bad_intent');
assert.equal(stalk.intent, 'approach-threaten-commit');
const stalkEarly = sampleMotionClip(stalk, 0.25);
const stalkLate = sampleMotionClip(stalk, 3.9);
assert.ok(stalkLate.root[2] > stalkEarly.root[2] + 1.4, 'stalk clip advances toward its target over time');
assert.ok(stalkLate.effort > stalkEarly.effort, 'stalk clip carries a late commitment effort spike');
assert.ok(Math.abs(stalkLate.facing[2] - 1) < 0.001, 'stalk clip faces forward at commitment');

const orbit = motionClipById('orbit_inspect');
const orbitA = sampleMotionClip(orbit, 0.0);
const orbitB = sampleMotionClip(orbit, orbit.duration / 2);
assert.ok(Math.abs(orbitA.root[0] - orbitB.root[0]) > 1.5, 'orbit clip traverses around the target');
assert.deepEqual(orbitA.attention, orbitB.attention, 'orbit clip keeps attention locked while root moves');

const fixture = buildMotionActorFixture();
assert.equal(fixture.schema, 'kaminos.motion-actors.v0');
assert.equal(fixture.route, MOTION_ROUTE_IDENTITY);
assert.ok(fixture.actors.length >= 5, 'default actor fixture covers each agency clip');
assert.ok(fixture.actors.every(actor => actor.id && actor.clipId && actor.label), 'actors carry stable ids, clips, and labels');
assert.deepEqual(DEFAULT_MOTION_ACTORS.map(actor => actor.id), fixture.actors.map(actor => actor.id), 'fixture preserves stable default actor order');

const resolved = resolveMotionActorClips([
  { id: 'valid', clipId: 'flinch_retreat', label: 'Valid' },
  { id: 'missing', clipId: 'no_such_clip', label: 'Missing' },
]);
assert.equal(resolved.effectiveActors[0].effectiveClipId, 'flinch_retreat');
assert.equal(resolved.effectiveActors[0].fallbackUsed, false);
assert.equal(resolved.effectiveActors[1].requestedClipId, 'no_such_clip');
assert.equal(resolved.effectiveActors[1].effectiveClipId, 'idle_breathe_watch');
assert.equal(resolved.effectiveActors[1].fallbackUsed, true);
assert.equal(resolved.effectiveActors[1].fallbackReason, 'unknown-clip-id');
assert.equal(resolved.fallbackCount, 1, 'unknown requested clips are counted in route evidence');

const simulation = simulateMotionActors({
  duration: 3,
  fps: 6,
  actors: [
    { id: 'stalker', clipId: 'stalk_bad_intent', label: 'Stalker', origin: [-1, 0, -1] },
    { id: 'flinch', clipId: 'flinch_retreat', label: 'Flinch', origin: [1, 0, 1] },
  ],
});
assert.equal(simulation.schema, 'kaminos.motion-simulation.v0');
assert.equal(simulation.route, MOTION_ROUTE_IDENTITY);
assert.equal(simulation.duration, 3);
assert.equal(simulation.fps, 6);
assert.equal(simulation.frames.length, 19, 'duration/fps sampling includes both endpoints');
assert.equal(simulation.frames[0].actors.length, 2);
assert.ok(simulation.metrics.maxEffort > 0.8, 'simulation captures high-effort agency accents');
assert.ok(simulation.metrics.meanSpeed > 0.05, 'simulation records non-trivial actor motion');
assert.ok(simulation.frames.some(frame => frame.actors.some(actor => actor.fallbackUsed === false)), 'frame evidence carries fallback truth per actor');

const timeline = buildMotionWitnessTimeline({
  duration: 4,
  fps: 8,
  filmstripFrames: 5,
  actors: fixture.actors.slice(0, 3),
});
assert.equal(timeline.schema, 'kaminos.motion-witness.v0');
assert.equal(timeline.route, MOTION_ROUTE_IDENTITY);
assert.equal(timeline.filmstrip.length, 5, 'witness timeline chooses a bounded filmstrip from full simulation');
assert.deepEqual(timeline.requestedClipIds, fixture.actors.slice(0, 3).map(actor => actor.clipId));
assert.deepEqual(timeline.effectiveClipIds, fixture.actors.slice(0, 3).map(actor => actor.clipId));
assert.ok(timeline.filmstrip.every(frame => typeof frame.frameIndex === 'number' && frame.actors.length === 3), 'filmstrip frames carry actor state');
