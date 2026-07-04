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
assert.match(index, /sideChoiceSource/, 'steering memory distinguishes latched side choice from per-frame fallback');
assert.match(index, /state\.pathWorldSteeringMemoryRuntime/, 'steering memory keeps short-lived runtime state across frames');
assert.match(index, /steeringMemoryReleaseMargin/, 'steering memory uses a release margin rather than dropping immediately at precontact boundary');

assert.match(liveWitness, /pathWorldSteeringMemory/, 'live witness records steering-memory evidence');
assert.match(liveWitness, /memorySide/, 'live witness labels expose the latched side choice');
assert.match(liveWitness, /memoryActive/, 'live witness labels expose memory-active state');
