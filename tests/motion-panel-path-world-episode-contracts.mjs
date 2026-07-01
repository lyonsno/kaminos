import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /kaminos\.generated-motion-path-world-interrupt-episode\.v0/,
  'path-world interrupt creates explicit episode evidence',
);
assert.match(index, /function createMotionPanelPathWorldInterruptEpisode/, 'browser creates latched path-world interrupt episodes');
assert.match(index, /function motionPanelPathWorldEpisodePhase/, 'browser derives episode phase from elapsed episode time');
assert.match(index, /function motionPanelPathWorldEpisodeRootPosition/, 'browser maps reaction samples through contact-space root placement');
assert.match(index, /function constrainMotionPanelPathWorldRootPosition/, 'browser applies cheap obstacle nonpenetration');
assert.match(index, /episodeId/, 'episode evidence carries a stable episode id');
assert.match(index, /contactFrame/, 'episode evidence carries a contact frame');
assert.match(index, /obstacleNormal/, 'episode contact frame includes obstacle normal');
assert.match(index, /incomingHeading/, 'episode contact frame includes incoming heading');
assert.match(index, /clearanceRadius/, 'episode contact frame records actor-plus-obstacle clearance');
assert.match(index, /suppressedUntilClear/, 'episode runtime suppresses repeated trigger firing until clear');
assert.match(index, /cooldownUntil/, 'episode runtime records cooldown exit timing');
assert.match(index, /triggered/, 'episode phase labels include triggered');
assert.match(index, /reaction/, 'episode phase labels include reaction');
assert.match(index, /cooldown/, 'episode phase labels include cooldown');
assert.match(index, /resume/, 'episode phase labels include resume');
assert.match(index, /pathWorldEpisode/, 'actor/debug evidence exposes the active path-world episode');
assert.match(index, /const pathTriggerMode = motionPanelClipletInterruptModeFromInputs\(\) === 'path-trigger'/, 'browser reads path-trigger mode once for routing');
assert.match(index, /const clipletInterruptTimeline = !pathWorldSample && pathTriggerMode/, 'source cliplet interrupts are fallback-only when no path-world sample is active');
assert.match(index, /const pathWorldInterruptEnvelope = pathWorldSample && pathTriggerMode/, 'path-trigger drives path-world episodes when path-world is active');

assert.match(liveWitness, /pathWorldEpisode/, 'live witness records path-world episode evidence');
assert.match(liveWitness, /episodePhase/, 'live witness filmstrip labels include episode phase evidence');
