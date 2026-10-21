import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The legacy beauty controls (volume-exposure, the Boundary Fire palette and
// transfer sliders) were retired with the legacy material laws (2026-10-18).
// What remains is the Physics law's grade: Exposure EV and Highlight knee.
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const settingsSchema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

function rangeControl(id) {
  const match = index.match(new RegExp(`<input[^>]+id="${id}"[^>]*>`));
  assert.ok(match, `${id} is an authored cockpit control`);
  return match[0];
}

function assertRange(id, { min, max, step = 'any' }) {
  const control = rangeControl(id);
  assert.match(control, new RegExp(`\\bmin="${min}"`), `${id} carries minimum ${min}`);
  assert.match(control, new RegExp(`\\bmax="${max}"`), `${id} carries maximum ${max}`);
  assert.match(control, new RegExp(`\\bstep="${step}"`), `${id} is not quantized onto a coarse slider lattice`);
}

assertRange('volume-physical-exposure', { min: '-8', max: '8' });
assert.match(index, /key: 'physicalExposureEV'[^\n]+min: -8[^\n]+max: 8[^\n]+continuous: true/, 'Exposure EV route metadata preserves its continuous range');
assert.match(index, /applyVolumeRangeSavedValue\(el, routeValue\)/, 'URL-route hydration applies saved values at full precision within the drawable range, without decimal quantization (tests/volume-exact-load-contracts.mjs)');

for (const retired of ['volume-exposure', 'volume-reaction-boundary-contrast', 'volume-reaction-boundary-fire-luma', 'volume-reaction-boundary-fire-soot-color']) {
  assert.doesNotMatch(index, new RegExp(`id="${retired}"`), `${retired} is retired from the cockpit`);
  assert.ok(settingsSchema.retiredControls.some(control => control.key === retired), `${retired} is a declared retirement`);
  assert.ok(!settingsSchema.controls.some(control => control.key === retired), `${retired} is no longer a canonical control`);
}

assert.equal(settingsSchema.controlCount, settingsSchema.controls.length, 'the canonical preset inventory count matches its authored schema');
const exposure = settingsSchema.controls.find(control => control.key === 'volume-physical-exposure');
assert.deepEqual(
  { key: exposure.key, param: exposure.param, tagName: exposure.tagName, type: exposure.type },
  { key: 'volume-physical-exposure', param: 'volume_physical_exposure', tagName: 'INPUT', type: 'range' },
  'Exposure EV keeps its strict canonical settings-preset descriptor',
);
console.log('beauty control contracts passed');
