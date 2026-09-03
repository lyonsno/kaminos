import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function control(id) {
  const match = index.match(new RegExp(`<input[^>]+id="${id}"[^>]*>`));
  assert.ok(match, `${id} is present in the authored cockpit`);
  return match[0];
}

function assertRange(id, { min, max, step }) {
  const source = control(id);
  assert.match(source, new RegExp(`\\bmin="${min}"`), `${id} has minimum ${min}`);
  assert.match(source, new RegExp(`\\bmax="${max}"`), `${id} has maximum ${max}`);
  assert.match(source, new RegExp(`\\bstep="${step}"`), `${id} has authoring increment ${step}`);
}

assertRange('volume-exposure', { min: '0', max: '3', step: 'any' });
assertRange('volume-reaction-boundary-fire-luma', { min: '0', max: '15', step: 'any' });
assertRange('volume-reaction-boundary-fire-clean-blue', { min: '0', max: '1', step: 'any' });
assert.match(core, /boundaryFireCleanBlue = clamp\([^\n]+0\.0, 1\.0\)/, 'WGSL Clean blue agrees with its authored ceiling');
assert.match(core, /boundaryFireLuma = clamp\([^\n]+0\.0, 15\.0\)/, 'WGSL Fire luma agrees with its authored ceiling');
assert.match(core, /volumeExposure = clamp\(u\.volume_presentation_controls\.x, 0\.0, 3\.0\)/, 'raymarch exposure agrees with its authored ceiling');
assert.match(core, /cleanBlue: Math\.max\(0, Math\.min\(1,/, 'CPU Clean blue agrees with its authored ceiling');
assert.match(core, /fireLuma: Math\.max\(0, Math\.min\(15,/, 'CPU Fire luma agrees with its authored ceiling');
assert.match(core, /clampFinite\(controlsSnapshot\.volumeExposure, 0, 3, 1\)/, 'CPU exposure agrees with its authored ceiling');

assert.match(core, /SUPPORTED_GRID_SIZES\s*=\s*\[[^\]]*128, 136, 140[^\]]*\]/, '136 cubed is a first-class grid between 128 and 140');
assert.match(index, /<option value="128">128\^3<\/option>\s*<option value="136">136\^3<\/option>\s*<option value="140">140\^3<\/option>/, 'the cockpit exposes the coherent 136 cubed grid');
assert.equal(136 % 4, 0, '136 preserves the compute workgroup divisor');
assert.equal(136 % 8, 0, '136 preserves the structure-grid divisor');

assertRange('volume-render-scale', { min: '0.1', max: '0.3', step: '0.001' });
assert.match(index, /id="volume-render-scale-full"[^>]+aria-pressed="false"[^>]*>Full<\/button>/, 'full resolution is an explicit endpoint instead of a continuous expensive band');
assert.match(index, /function readVolumeRenderScaleControlValue\(\)[\s\S]*dataset\.effectiveValue/, 'render-scale reads its exact effective value rather than only the visible low-band thumb');
assert.match(index, /function setVolumeRenderScaleControlValue\([^)]*\)[\s\S]*legacy[\s\S]*dataset\.effectiveValue/, 'legacy intermediate preset values remain exact and visibly classified');
assert.match(index, /renderScale: readVolumeRenderScaleControlValue\(\)/, 'runtime control capture consumes the exact render-scale authoring state');
assert.match(index, /volume-render-scale-val'\)\.textContent = `\$\{\(c\.renderScale \* 100\)\.toFixed\(1\)\}%`/, 'render scale is displayed with one decimal percentage place');
assert.match(index, /volume-render-scale-full'[\s\S]*readVolumeRenderScaleControlValue\(\) === 1 \? lowBandValue : 1/, 'the Full endpoint toggles back to the low authoring band');
assert.match(core, /return Math\.max\(0\.1, Math\.min\(1, requested\)\)/, 'the runtime still accepts exact full resolution and legacy preset values');
assert.match(
  index,
  /function readVolumeBasinDriveDirectControlValue\(el\)[\s\S]*el\?\.id === 'volume-render-scale'[\s\S]*Number\(el\.value\)[\s\S]*return readVolumeDomControlValue\(el\)/,
  'a direct render-scale gesture records the live thumb instead of the previous dataset-backed effective value',
);
assert.match(
  index,
  /function volumeBasinDriveTarget\(event, descriptors\)[\s\S]*requested: descriptorKey \? readVolumeBasinDriveDirectControlValue\(target\) : null/,
  'basin-drive recording distinguishes the direct gesture value from stable snapshot state',
);
assert.match(
  index,
  /const syncControls = event => \{\s*if \(event\?\.target\?\.id === 'volume-render-scale' && event\.isTrusted === true\) adoptVolumeRenderScaleSliderValue\(\)/,
  'only trusted slider gestures adopt the visible thumb so replay hydration preserves Full and legacy scales',
);

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
