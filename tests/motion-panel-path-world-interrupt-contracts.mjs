import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(
  index,
  /kaminos\.generated-motion-path-world\.v0/,
  'browser route declares the path-world scene schema',
);
assert.match(
  index,
  /kaminos\.generated-motion-path-world-interrupt\.v0/,
  'browser route declares path-world interrupt evidence',
);
assert.match(
  index,
  /function createGeneratedPoseTemporalPathWorld/,
  'browser route builds a visible generated temporal path-world',
);
assert.match(
  index,
  /function sampleMotionPanelPathWorld/,
  'browser route samples deterministic world-path traversal',
);
assert.match(
  index,
  /function motionPanelPathWorldInterruptFromSample/,
  'browser route derives object-triggered cliplet interrupt playback from the path-world sample',
);
assert.match(
  index,
  /generated-pose-temporal-path-world-route/,
  'browser route names the visible path-world route object',
);
assert.match(
  index,
  /generated-pose-temporal-path-world-wall/,
  'browser route names the visible path-world wall obstacle',
);
assert.match(
  index,
  /generated-pose-temporal-path-world-goal/,
  'browser route names the visible path-world goal marker',
);
assert.match(
  index,
  /generated-pose-temporal-path-world-trigger/,
  'browser route names the visible path-world trigger volume',
);
assert.match(
  index,
  /pathWorldActiveSource/,
  'browser actor debug records whether source is world-path or cliplet-playback',
);
assert.match(index, /world-path/, 'path-world evidence names world-path traversal');
assert.match(index, /cliplet-playback/, 'path-world evidence names interrupt cliplet playback');
assert.match(index, /pathWorldInterrupt/, 'browser debug exposes path-world interrupt state');

assert.match(liveWitness, /pathWorld/, 'live witness records path-world evidence');
assert.match(liveWitness, /pathWorldInterrupt/, 'live witness records path-world interrupt evidence');
assert.match(liveWitness, /pathWorldActiveSource/, 'live witness records path-world active source');
