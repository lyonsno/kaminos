import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /kaminos\.generated-motion-path-world-steering-memory\.v0/,
  'path-world sampling must create explicit steering-memory evidence',
);
assert.match(index, /createMotionPanelPathWorldSteeringMemory/, 'browser creates steering memory before intent application');
assert.match(index, /applyMotionPanelPathWorldSteeringMemory/, 'browser applies smoothed memory bias instead of only per-frame projection');
assert.match(index, /pathWorldSteeringMemory/, 'actor/debug evidence exposes path-world steering memory');
assert.match(index, /memorySide/, 'steering memory records the latched side choice');
assert.match(index, /memoryActive/, 'steering memory records whether the latch is currently active');
assert.match(index, /memoryRelease/, 'steering memory records release/hysteresis evidence');
assert.match(index, /smoothedRouteBias/, 'steering memory records the smoothed route bias');
assert.match(index, /smoothedPostMemoryRoot/, 'steering memory records a smoothed post-memory root, not only a bias vector');
assert.match(index, /lastPostMemoryRoot/, 'steering memory runtime persists the prior post-memory root across frames');
assert.match(index, /rootVelocityLimit/, 'steering memory records an active encounter root velocity limit');
assert.match(index, /limitMotionPanelPathWorldRootStep/, 'steering memory limits root step distance across active encounter frames');
assert.match(index, /rootHandoffDistance/, 'steering memory records distance to the raw route root before releasing');
assert.match(index, /root-handoff/, 'steering memory release keeps authority during root handoff, not only obstacle-distance release');
assert.match(index, /memoryClearanceRadius/, 'active steering memory records the clearance radius used to avoid trigger re-entry');
assert.match(index, /clearanceProjectionApplied/, 'active steering memory records when it projects the root back outside obstacle clearance');
assert.match(index, /sideChoiceSource/, 'steering memory distinguishes latched side choice from per-frame fallback');
assert.match(index, /state\.pathWorldSteeringMemoryRuntime/, 'steering memory keeps short-lived runtime state across frames');
assert.match(index, /steeringMemoryReleaseMargin/, 'steering memory uses a release margin rather than dropping immediately at precontact boundary');
assert.match(
  index,
  /pathWorldSteeringIntent\.postSteeringRoot\s*\|\|\s*\[/,
  'applying steering memory must use postSteeringRoot directly instead of recomputing rawRoot plus bias',
);
assert.match(
  index,
  /memoryRootOverrideActive/,
  'active steering memory must retain root authority even when route-bias magnitude is nearly zero',
);

assert.match(liveWitness, /pathWorldSteeringMemory/, 'live witness records steering-memory evidence');
assert.match(liveWitness, /memorySide/, 'live witness labels expose the latched side choice');
assert.match(liveWitness, /memoryActive/, 'live witness labels expose memory-active state');
