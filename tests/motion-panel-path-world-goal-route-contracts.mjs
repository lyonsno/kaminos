import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /routeMode:\s*'goal-seeking'/,
  'Path World fixture must default to explicit goal-seeking route mode, not implicit ping-pong patrol',
);
assert.match(
  index,
  /sampleMotionPanelPathWorldGoalProgress/,
  'Path World sampling must use a named goal-progress helper instead of inline ping-pong progress',
);
assert.match(
  index,
  /sampleMotionPanelPathWorldGoalProgress\(pathWorld,\s*elapsedTime,\s*cycle\)/,
  'goal-seeking Path World progress must be sampled from unwrapped elapsed time so it can hold at the goal',
);
assert.doesNotMatch(
  index,
  /sampleMotionPanelPathWorldGoalProgress\(pathWorld,\s*wrappedTime,\s*cycle\)/,
  'wrapped path-world time must not drive goal-seeking progress because that silently restarts at the spawn',
);
assert.doesNotMatch(
  index,
  /reason:\s*forward\s*\?\s*'seeking-goal'\s*:\s*'returning-to-start'/,
  'goal-seeking Path World sampling must not implicitly label the second half as returning-to-start',
);
assert.match(
  index,
  /routeMode === 'patrol-return'/,
  'return-to-start behavior must be reserved for an explicit patrol-return route mode',
);
assert.match(
  index,
  /advanceMotionPanelPathWorldProgress/,
  'resume handoff target progress must advance from pre-encounter progress rather than sample wrapped ping-pong time',
);
assert.match(
  index,
  /targetProgressBasis:\s*routeMode === 'goal-seeking'\s*\?\s*'goal-advance'/,
  'resume handoff evidence must record that target progress came from goal advance',
);
assert.match(
  index,
  /routeMode/,
  'actor/debug evidence must expose path-world route mode',
);
assert.match(
  liveWitness,
  /routeMode/,
  'live witness must record path-world route mode in frame evidence',
);
