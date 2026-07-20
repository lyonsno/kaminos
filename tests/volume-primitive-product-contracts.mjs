import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');

assert.match(
  core,
  /VOLUME_PRIMITIVE_UNIFORM_DIAGNOSTIC_IDENTITY\s*=\s*'kaminos-volume-primitive-uniform-diagnostic-v0'/,
  'the bounded first-primitive uniform path is labeled diagnostic rather than product authority',
);
assert.match(
  core,
  /VOLUME_PRIMITIVE_UNIFORM_DIAGNOSTIC_APPLIED_CHANNELS[\s\S]*source-position[\s\S]*source-radius[\s\S]*source-flow-rate/,
  'the diagnostic receipt reports only channels consumed by the legacy uniform path',
);
assert.match(
  core,
  /updateBehavior\s*=\s*'reseed-fluid-state'/,
  'the persisted scene-load setter retains explicit reseed behavior by default',
);
assert.match(
  core,
  /if \(device && updateBehavior === 'reseed-fluid-state'\)[\s\S]*fluidStateResetApplied:\s*resetCountAfter !== resetCountBefore/,
  'only explicit reseed behavior rebuilds fluid state, and the receipt derives reset truth from counters',
);
assert.match(core, /unsupported-coordinate-space/, 'unsupported diagnostic coordinates fail loud');
assert.match(core, /unsupported-shape/, 'unsupported diagnostic shapes fail loud');
assert.match(core, /unsupported-primitive-count/, 'later persisted primitives cannot silently impersonate runtime consumption');
assert.match(index, /setDynamicVolumeSources/, 'the product interaction surface uses the shared dynamic-source ABI');
assert.doesNotMatch(
  index,
  /setVolumePrimitivesState\([^)]*,\s*\{[\s\S]*updateBehavior:\s*'preserve-fluid-state'/,
  'the product interaction surface no longer drives the first-primitive uniform diagnostic',
);

console.log('volume primitive diagnostic contracts passed');
