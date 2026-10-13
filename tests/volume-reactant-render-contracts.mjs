import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMISSIVE_TRANSPORT_WGSL } from '../volume-emissive-transport.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('../scene-volume-source.mjs', import.meta.url), 'utf8');
const emissiveSource = readFileSync(new URL('../volume-emissive-transport.mjs', import.meta.url), 'utf8');
const fnBody = (text, name) => text.split(`fn ${name}(`)[1].split('\n}')[0];

// The renderer under the reactant law: reaction light follows the fresh burn
// rate (the sidecar's second channel), not fuel presence through front memory;
// the soot amount is the raw smoke channel, not smoke folded with micro/detail.
// Under the authored law both formulas are the originals.

test('the reconstruction sample carries the fresh burn rate, sampled from the sidecar only under the reactant law', () => {
  assert.match(source, /struct FlowReconstructionSample \{[^}]*frontTopology: f32,\n(?:\s*\/\/.*\n)*\s*freshBurn: f32,\n\};/, 'the sample struct carries freshBurn after frontTopology');
  assert.match(source, /sample\.frontTopology = sampleWorldFrontField\(p\);\n\s*sample\.freshBurn = sampleWorldReactantBurn\(p\);/, 'the raw sampler fills it');
  const mixBody = fnBody(source, 'mixFlowReconstructionSample');
  assert.match(mixBody, /filtered\.freshBurn = center\.freshBurn \* centerWeight \+ \(forward\.freshBurn \+ backward\.freshBurn\) \* neighborWeight;/, 'the tangent filter blends it like the front');
  assert.match(mixBody, /result\.freshBurn = max\(0\.0, mix\(center\.freshBurn, filtered\.freshBurn, strength\)\);/);
  const worldBody = fnBody(source, 'sampleWorldReactantBurn');
  assert.match(worldBody, /if \(!reactantLawOn\(\)\) \{ return 0\.0; \}/, 'under the authored law the 1x1x1 placeholder is never read');
  assert.match(worldBody, /return sampleReactantBurn\(worldToCell\(p\)\);/);
  const cellBody = fnBody(source, 'sampleReactantBurn');
  assert.match(cellBody, /textureLoad\(reactantSrc, vec3<i32>\(clampCell\(sampleCell\)\), 0\)\.y/, 'reads the fresh burn channel, plain trilinear');
  assert.doesNotMatch(cellBody, /sceneSolidAt|u\.reactant_combustion_c\.z/, 'no solid mask (solid cells hold zero burn; a mask would drag the scene-solid texture into every auto-layout kernel that reaches the renderer) and no ambient fallback');
});

test('the renderer: reaction light from the burn rate and raw soot under the reactant law, originals otherwise', () => {
  const body = fnBody(EMISSIVE_TRANSPORT_WGSL, 'emissiveMaterial');
  assert.match(body, /let reactant = u\.reactant_combustion_a\.x > 0\.5;/);
  assert.match(body, /let smokeAmount = select\(m\.x\+d\.x\*0\.50\+m\.w\*0\.08, m\.x, reactant\) \* max\(0\.0, u\.viewport_steps_density\.w\);/, 'raw soot under the candidate (what crosses to the exterior), the folded amount under the authored law');
  assert.match(body, /let burnLight = reactionLightFromBurn\(r\.freshBurn, u\.reactant_combustion_d\.x\);/, 'the reaction signal is the fresh burn normalised by the appearance burn reference');
  assert.match(body, /let reactionDrive = select\(front\*freshFuel, burnLight, reactant\);/, 'fuel presence and front memory drive reaction light only under the authored law');
  assert.match(body, /let clean = max\(0\.0,coverage\)\*reactionDrive\*exp\(-sootYield\*smokeAmount\*4\.0-hotSoot\*2\.0\);/, 'soot still suppresses reaction light locally');
  assert.match(body, /let energy = emissiveHeatSource\(m, f, d, transported\);/, 'thermal glow is unchanged: temperature from transported heat');
  // The scalar law, executed from production source (the emission test's own method).
  const scalar = EMISSIVE_TRANSPORT_WGSL.split('fn reactionLightFromBurn(')[1].split('\n}')[0].split('-> f32 {')[1];
  const lightAt = new Function('freshBurn', 'reference', 'max', 'exp', scalar);
  const at = (b, ref = 0.04) => lightAt(b, ref, Math.max, Math.exp);
  assert.equal(at(0), 0, 'no burning, no reaction light');
  assert.equal(at(-1), 0, 'a negative sample is no burning');
  assert.ok(Math.abs(at(0.04) - (1 - Math.exp(-1))) < 1e-12, 'one reference burn gives 1 - 1/e');
  assert.ok(at(0.01) < at(0.02) && at(0.02) < at(0.08) && at(0.08) < 1, 'monotone and bounded');
  assert.ok(Math.abs(at(0.04, 0) - 1) < 1e-6, 'a zero reference is guarded, not a division by zero');
});

test('every pipeline that reaches the emission function can see the sidecar: fragment visibility, the sidecar-read layout, and the two auto-layout kernels', () => {
  assert.match(source, /\{ binding: 23, visibility: GPUShaderStage\.FRAGMENT \| GPUShaderStage\.COMPUTE, texture: \{ sampleType: 'unfilterable-float', viewDimension: '3d' \} \},/, 'the raymarch fragment reads it through the shared fluid layout');
  const sidecarLayout = source.split('boundarySidecarReadBindGroupLayout = device.createBindGroupLayout({')[1].split('});')[0];
  assert.match(sidecarLayout, /\{ binding: 23, visibility: GPUShaderStage\.COMPUTE, texture: \{ sampleType: 'unfilterable-float', viewDimension: '3d' \} \},/, 'the irradiance seed runs under the sidecar-read layout');
  // Lazy to the first line that is only `],`: entries themselves contain `fluidBuffers[0]`.
  const sidecarGroups = source.match(/layout: boundarySidecarReadBindGroupLayout,\n\s*entries: \[[\s\S]*?\n\s*\],/g) ?? [];
  assert.equal(sidecarGroups.length, 4, 'four bind groups are built on that layout');
  for (const group of sidecarGroups) assert.match(group, /\{ ?binding: 23, resource: reactantTextureView\(/, `every one of them binds the sidecar:\n${group}`);
  assert.match(source, /function reactantTextureView\(index\) \{/, 'one helper hands out the view and allocates the placeholders if a rebuild runs before the grid allocation');
  assert.match(source, /if \(ensureReactantSidecar\(reactantCombustionConfig\.effective\.admitted\)\) \{\s*\n\s*rebuildFluidBindGroups\(\);\s*\n\s*rebuildSceneSolidBindingViews\(\);\s*\n\s*rebuildSelectiveHeadLiveBindGroups\(\);/, 'a reallocated sidecar rebuilds the sidecar-read groups too');
  assert.match(emissiveSource, /export function createEmissiveLightField\(device, module, uniformBuffer, fluidBuffers, frontBuffers, getReactantTextures\)/);
  assert.match(emissiveSource, /\{ binding: 23, resource: textures\[i\]\.createView\(\{ dimension: '3d' \}\) \}/, 'the light-field seed binds the sidecar paired with its fluid buffer');
  assert.match(emissiveSource, /if \(getReactantTextures\(\) !== boundTextures\) seedInputs = buildSeedInputs\(\);/, 'and rebinds when the sidecar is reallocated');
  assert.match(source, /createEmissiveLightField\(device, shader, uniformBuffer, fluidBuffers, frontBuffers, \(\) => reactantTextures\)/);
  assert.match(sceneSource, /getReactantTextures/, 'the scene-source seed takes the sidecar the same way');
  assert.match(sceneSource, /\{binding: 23, resource: textures\[i\]\.createView\(\{dimension: '3d'\}\)\}/);
  assert.match(sceneSource, /if \(getReactantTextures\(\) !== boundTextures\) inputs = buildInputs\(\);/);
  assert.match(source, /createSceneVolumeSource\(\{device, module: shader, uniformBuffer, fluidBuffers, frontBuffers, getReactantTextures: \(\) => reactantTextures,/);
});
