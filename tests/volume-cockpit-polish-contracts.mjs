import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function control(id) {
  const match = index.match(new RegExp(`<input[^>]+id="${id}"[^>]*>`));
  assert.ok(match, `${id} is present in the authored cockpit`);
  return match[0];
}

assertRange('volume-physical-exposure', { min: '-8', max: '8', step: 'any' });

function assertRange(id, { min, max, step }) {
  const source = control(id);
  assert.match(source, new RegExp(`\\bmin="${min}"`), `${id} has minimum ${min}`);
  assert.match(source, new RegExp(`\\bmax="${max}"`), `${id} has maximum ${max}`);
  assert.match(source, new RegExp(`\\bstep="${step}"`), `${id} has authoring increment ${step}`);
}


assert.match(core, /SUPPORTED_GRID_SIZES\s*=\s*\[[^\]]*128, 136, 140[^\]]*\]/, '136 cubed is a first-class grid between 128 and 140');
assert.match(index, /<option value="128">128<\/option>\s*<option value="136">136<\/option>\s*<option value="140">140<\/option>/, 'the cockpit exposes the grid widths separately from height');
assert.equal(136 % 4, 0, '136 preserves the compute workgroup divisor');
assert.equal(136 % 8, 0, '136 preserves the structure-grid divisor');

assertRange('volume-render-scale', { min: '0.1', max: '1', step: 'any' });
const scaleControl=control('volume-render-scale');assert.match(scaleControl,/step="any"/, 'render scale retains exact values instead of quantizing authored fractions');
assert.match(index,/renderScale: readVolumeRenderScaleControlValue\(\)/,'runtime capture retains exact render scale');
assert.match(core, /return Math\.max\(0\.1, Math\.min\(1, requested\)\)/, 'the runtime still accepts exact full resolution and legacy preset values');
assert.match(index,/function readVolumeRenderScaleControlValue\(\)[\s\S]*value/, 'source render scale reads its numeric control');
assert.match(index, /id="raymarch-smoke-presentation-control"[^>]+data-requested-mode="on"/, 'Smoke On/Off owns stable authored requested state');
assert.match(index, /function readRaymarchSmokePresentationRequestedMode\(\)[\s\S]*dataset\.requestedMode/, 'preset capture reads authored Smoke state from the control surface');
assert.match(index, /function readVolumeSettingsPresentationControls\(\)[\s\S]*readRaymarchSmokePresentationRequestedMode\(\)[\s\S]*raymarch-smoke-presentation-requested-state-mismatch/, 'preset capture fails loud when authored Smoke state and runtime receipt disagree');
assert.doesNotMatch(index, /const value = receipt\?\.normalizedRequestedMode \|\| receipt\?\.requestedMode \|\| 'on'/, 'preset capture never silently replaces missing Smoke state with on');

assert.match(index, /#transform-bar\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/, 'the top transform toolbar has a hard hidden state');
assert.match(index, /function setActiveTab\(tabName\)[\s\S]*transformBar\.hidden = tabName === 'volume'/, 'the unused transform toolbar is suppressed in the Volume cockpit');

const splatGroup = index.match(/<details class="volume-collapsible-group" data-volume-collapsible-group="splat-settings">[\s\S]*?<\/details>/)?.[0];
assert.ok(splatGroup, 'Boundary Fire splat settings live in one collapsible group');
for (const id of [
  'volume-boundary-splat-mode',
  'volume-boundary-splat-radius',
  'volume-boundary-splat-sharpness',
  'volume-flow-kernel-strength',
  'volume-flow-kernel-radius',
  'volume-flow-kernel-coherence',
  'volume-boundary-sidecar-blur',
  'volume-boundary-sidecar-width',
]) {
  assert.match(splatGroup, new RegExp(`id="${id}"`), `${id} is collapsible with the splat settings`);
}
assert.doesNotMatch(splatGroup, /id="volume-boundary-sidecar-ridge"/, 'main baked-ridge intensity remains usable without opening Splat settings');
assert.doesNotMatch(splatGroup, /id="volume-reaction-boundary-fire-ridge"/, 'fire shaping remains outside the splat disclosure');

console.log('volume cockpit polish contracts passed');
