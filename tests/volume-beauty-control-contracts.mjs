import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
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

assertRange('volume-exposure', { min: '0', max: '20' });
assertRange('volume-reaction-boundary-contrast', { min: '0.25', max: '1.5' });
assertRange('volume-reaction-boundary-fire-yellow', { min: '0', max: '0.4' });
assertRange('volume-reaction-boundary-fire-warmth', { min: '0', max: '0.4' });
assertRange('volume-reaction-boundary-fire-luma', { min: '0', max: '20' });

assert.match(index, /key: 'reactionBoundaryContrast'[^\n]+max: 1\.5[^\n]+continuous: true/, 'Boundary contrast route metadata preserves the continuous 1.5 ceiling');
assert.match(index, /key: 'reactionBoundaryFireYellow'[^\n]+max: 0\.4[^\n]+continuous: true/, 'Soot yellowing route metadata preserves the continuous 0.4 ceiling');
assert.match(index, /key: 'reactionBoundaryFireWarmth'[^\n]+max: 0\.4[^\n]+continuous: true/, 'Thermal warmth route metadata preserves the continuous 0.4 ceiling');
assert.match(index, /key: 'reactionBoundaryFireLuma'[^\n]+max: 20[^\n]+continuous: true/, 'Boundary Fire luma route metadata preserves the continuous 20 ceiling');

assert.match(index, /id="volume-reaction-boundary-fire-clean-color"[^>]+value="#[0-9a-f]{6}"/i, 'Boundary Fire exposes an authored clean-fuel color endpoint');
assert.match(index, /id="volume-reaction-boundary-fire-soot-color"[^>]+value="#[0-9a-f]{6}"/i, 'Boundary Fire exposes an authored soot-hot color endpoint');
assert.match(index, /reactionBoundaryFireControls:[\s\S]*cleanColor:[\s\S]*sootColor:/, 'Boundary Fire palette endpoints reach the grouped runtime control contract');

assert.match(core, /displayContrast: Math\.max\(0\.25, Math\.min\(1\.5,/, 'CPU Boundary contrast clamp agrees with the cockpit ceiling');
assert.match(core, /sootYellowing: Math\.max\(0, Math\.min\(0\.4,/, 'CPU soot-yellowing clamp agrees with the cockpit ceiling');
assert.match(core, /thermalWarmth: Math\.max\(0, Math\.min\(0\.4,/, 'CPU thermal-warmth clamp agrees with the cockpit ceiling');
assert.match(core, /fireLuma: Math\.max\(0, Math\.min\(20,/, 'CPU Boundary Fire luma clamp agrees with the cockpit ceiling');
assert.match(core, /boundaryContrast = clamp\([^\n]+0\.25, 1\.5\)/, 'WGSL Boundary contrast clamp agrees with the cockpit ceiling');
assert.match(core, /boundaryFireSootYellowing = clamp\([^\n]+0\.0, 0\.4\)/, 'WGSL soot-yellowing clamp agrees with the cockpit ceiling');
assert.match(core, /boundaryFireThermalWarmth = clamp\([^\n]+0\.0, 0\.4\)/, 'WGSL thermal-warmth clamp agrees with the cockpit ceiling');
assert.match(core, /boundaryFireLuma = clamp\([^\n]+0\.0, 20\.0\)/, 'WGSL Boundary Fire luma clamp agrees with the cockpit ceiling');
assert.match(core, /boundaryFireCleanEndpoint = u\.boundary_fire_palette_clean\.rgb[\s\S]*boundaryFireSootEndpoint = u\.boundary_fire_palette_soot\.rgb/, 'Boundary Fire consumes both dedicated authored palette endpoints');

assert.match(core, /volumeExposure = clamp\(u\.volume_presentation_controls\.x, 0\.0, 20\.0\)/, 'raymarch reads the volume-wide exposure uniform');
assert.match(core, /exp\(-color \* \(0\.96 \* volumeExposure\)\)/, 'raymarch applies volume exposure before its shared tone curve');
assert.match(core, /struct VolumePresentationControls\s*\{\s*exposure: vec4<f32>,\s*\};/, 'the 16-byte host presentation buffer has an exact 16-byte WGSL layout');
assert.match(core, /@group\(0\) @binding\(1\) var<uniform> presentationControls/, 'splat presentation has a first-class exposure uniform');
assert.match(core, /presentationControls\.exposure\.x/, 'matched splat presentation reads exposure from the aligned vec4 component');
assert.match(core, /entries:[\s\S]*binding: 0,[\s\S]*boundarySplatHdrTexture[\s\S]*binding: 1,[\s\S]*volumePresentationControlsBuffer/, 'matched splat resolve binds the same top-level exposure control');
assert.match(core, /uniforms\[332\] = volumeExposure/, 'the main raymarch uniform receives the effective exposure');
assert.match(core, /volumePresentationControls\[0\] = volumeExposure[\s\S]*writeBuffer\(volumePresentationControlsBuffer/, 'the splat presentation uniform receives the same effective exposure');

assert.match(index, /volumeExposure: 'volume-exposure'/, 'snapshot hydration maps volumeExposure to the authored top-level control');
assert.match(index, /if \(key === 'volumeExposure' \|\| field\?\.continuous\) return String\(value\);/, 'continuous snapshot values, including top-level exposure, bypass display-only decimal formatting');
assert.match(index, /field\.continuous\s*\?\s*String\(clampedValue\)\s*:\s*clampedValue\.toFixed\(field\.decimals\)/, 'continuous URL-route hydration preserves the clamped numeric value without decimal quantization');
assert.match(core, /const resolveEntries = \[[\s\S]*if \(options\.includePresentationControls === true\)[\s\S]*resolveEntries\.push\([\s\S]*binding: 1/, 'optical resolves add presentation binding 1 only for pipelines that declare it');
assert.match(core, /includePresentationControls: options\.opticalDepthOrderDiagnostic !== true/, 'matched optical presentation binds exposure while the depth-order diagnostic keeps its one-binding layout');

assert.equal(settingsSchema.controlCount, 189, 'the canonical preset inventory includes all three new beauty controls');
for (const expected of [
  ['volume-exposure', 'volume_exposure', 'range'],
  ['volume-reaction-boundary-fire-clean-color', 'volume_reaction_boundary_fire_clean_color', 'color'],
  ['volume-reaction-boundary-fire-soot-color', 'volume_reaction_boundary_fire_soot_color', 'color'],
]) {
  const [key, param, type] = expected;
  assert.deepEqual(
    settingsSchema.controls.find(control => control.key === key),
    { key, param, tagName: 'INPUT', type },
    `${key} is a strict canonical settings-preset control`,
  );
}

console.log('volume beauty controls: continuous ranges, palette, and shared exposure contracts pass');
