import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /kaminos\.generated-motion-path-world-encounter-trajectory\.v0/,
  'path-world encounters must create explicit trajectory evidence',
);
assert.match(index, /function createMotionPanelPathWorldEncounterTrajectory/, 'browser creates episode-owned encounter trajectories');
assert.match(index, /function sampleMotionPanelPathWorldEncounterTrajectory/, 'browser samples encounter trajectories by episode phase');
assert.match(index, /trajectoryId/, 'encounter trajectory carries a stable trajectory id');
assert.match(index, /exitSide/, 'encounter trajectory records the chosen exit side');
assert.match(index, /retreatPoint/, 'encounter trajectory records a reaction retreat point');
assert.match(index, /resumePoint/, 'encounter trajectory records a resume point');
assert.match(index, /trajectoryPhase/, 'runtime/debug evidence reports the active encounter trajectory phase');
assert.match(index, /pathWorldEncounterTrajectory/, 'actor/debug evidence exposes path-world encounter trajectory evidence');
assert.match(
  index,
  /motionPanelPathWorldEncounterTrajectoryRootPosition/,
  'episode root placement is authored by the encounter trajectory instead of direct contact-frame offsets',
);
assert.doesNotMatch(
  index,
  /return contactPoint\.lerp\(fallbackRoot\.clone\(\), u\)\.setY\(fallbackRoot\.y\);/,
  'cooldown must not blend straight back into the original path sample as its primary trajectory',
);

assert.match(liveWitness, /pathWorldEncounterTrajectory/, 'live witness records encounter trajectory evidence');
assert.match(liveWitness, /trajectoryPhase/, 'live witness labels expose active encounter trajectory phase');
