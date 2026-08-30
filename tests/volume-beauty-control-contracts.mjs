import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

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
assert.match(core, /struct VolumePresentationControls[\s\S]*exposure:[\s\S]*@group\(0\) @binding\(1\) var<uniform> presentationControls/, 'splat presentation has a first-class exposure uniform');
assert.match(core, /entries:[\s\S]*binding: 0,[\s\S]*boundarySplatHdrTexture[\s\S]*binding: 1,[\s\S]*volumePresentationControlsBuffer/, 'matched splat resolve binds the same top-level exposure control');
assert.match(core, /uniforms\[332\] = volumeExposure/, 'the main raymarch uniform receives the effective exposure');
assert.match(core, /volumePresentationControls\[0\] = volumeExposure[\s\S]*writeBuffer\(volumePresentationControlsBuffer/, 'the splat presentation uniform receives the same effective exposure');

console.log('volume beauty controls: continuous ranges, palette, and shared exposure contracts pass');
