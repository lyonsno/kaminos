import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');
const page = readFileSync(join(root, 'hand-state-runtime.html'), 'utf8');
const moduleSource = readFileSync(join(root, 'hand-state-runtime.mjs'), 'utf8');
const fingerJuiceSource = readFileSync(join(root, 'hand-state-finger-juice.mjs'), 'utf8');

assert.match(index, /data-tab="hand-state"/, 'Kaminos exposes a Hand tab');
assert.match(index, /id="tab-hand-state"/, 'Hand tab has operator controls');
assert.match(index, /id="hand-state-runtime-frame"/, 'Hand tab mounts the live runtime viewer');
assert.match(index, /hand-state-runtime\.html/, 'Hand tab loads the dedicated live viewer');
assert.match(index, /palm-continuous-fluid-0718b/, 'Hand tab cache identity advances with the transparent continuous-fluid composition');

assert.match(page, /Start Hand/, 'viewer has one explicit camera start command');
assert.match(page, /data-runtime-owner="hand-state-runtime"/, 'viewer declares runtime ownership');
assert.match(moduleSource, /127\.0\.0\.1:8766/, 'viewer defaults to the neutral runtime server');
assert.match(moduleSource, /\/native-frame/, 'browser camera frames go to the runtime server');
assert.match(moduleSource, /\/sidecar\/start/, 'runtime server owns sidecar launch');
assert.match(moduleSource, /\/sidecar\/stop/, 'runtime server owns sidecar stop');
assert.match(moduleSource, /\/state\/next\?after_sequence=/, 'viewer waits for runtime-owned state events');
assert.match(moduleSource, /BufferGeometry/, 'viewer renders a real mesh geometry');
assert.match(moduleSource, /mano\.vertices/, 'viewer consumes runtime MANO vertices');
assert.match(moduleSource, /mano\.faces/, 'viewer consumes runtime MANO faces');
assert.match(moduleSource, /MANO_DISPLAY_ORIENTATION_CONTRACT/, 'viewer reports the effective MANO orientation contract');
assert.match(fingerJuiceSource, /mano-camera-display-x-preserved-y-inverted-v1/, 'orientation adapter names the camera/display transform that preserves thumb side');
assert.match(moduleSource, /wilor-mano-surface\.json/, 'visual fixture uses a recorded WiLoR MANO surface');
assert.doesNotMatch(moduleSource, /addBox|BoxGeometry|fixtureMano/, 'viewer must not synthesize substitute hand geometry');

for (const [name, source] of [['page', page], ['module', moduleSource]]) {
  assert.doesNotMatch(source, /perceptasia/i, `${name} must not retain a Perceptasia route or dependency`);
}

console.log('hand-state tab contracts passed');
