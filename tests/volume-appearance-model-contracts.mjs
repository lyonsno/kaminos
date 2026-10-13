import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const mainKernel = (() => { const start = source.indexOf('fn cs(@builtin(global_invocation_id) gid: vec3<u32>) {'); return source.slice(start, source.indexOf('\n}\n', start)); })();
const fnBody = name => { const at = source.indexOf(`fn ${name}(`); return source.slice(at, source.indexOf('\n}\n', at)); };

// Appearance model switch (compression study, 2026-10-13): under `compact-3`
// the kernel stores three appearance carriers (flame, interface shred, combustion
// front); the six others are rebuilt from them at the slot samplers by fixed
// pooled ratios, so every downstream formula is unchanged and the A/B asks one
// question: is three-carrier state enough for the look. `authored` is bit-for-bit
// the existing model.

test('the compact expansion is one law with the pooled coefficients, applied to the carrier slots at every sampler', () => {
  assert.deepEqual(core.APPEARANCE_MODELS, ['authored', 'compact-3']);
  assert.deepEqual(core.COMPACT_CARRIER_RATIOS, {
    ember: [0.575, 0.016, 0.229], flameDetail: [0.866, 0, 0.110], fireLick: [1.258, 0.068, 0.214],
    emberFleck: [0.111, 0.050, 2.744], materialDetail: [0.004, 0.617, 0], microSmoke: [0, 0, 0],
  }, '[flame, shred, front] weights; negatives from the fit are dropped (0)');
  const body = fnBody('expandCompactCarriers');
  assert.match(body, /fn expandCompactCarriers\(slot: u32, value: vec4<f32>, flame: f32, shred: f32, front: f32\) -> vec4<f32>/);
  assert.match(body, /if \(!compactAppearanceOn\(\)\) \{ return value; \}/, 'the authored model returns the stored value untouched');
  // One seam per module: the raw slot read. Every sampler (trilinear, masked, inflow-ghost,
  // splat) and every direct reader goes through it.
  assert.match(fnBody('readSlot'), /if \(slot < 2u \|\| !compactAppearanceOn\(\)\) \{ return value; \}[^]*return expandCompactCarriers\(slot, value, fire\.x, micro\.y, fire\.w\);/, 'the main module expands at readSlot');
  assert.match(fnBody('boundarySplatReadSlot'), /return expandCompactCarriers\(slot, value, fire\.x, micro\.y, fire\.w\);/, 'the splat module expands at its raw read');
  for (const name of ['sampleFluidSlot', 'sampleFluidSlotMasked']) assert.match(fnBody(name), /readSlot\(/, `${name} reads through the seam`);
  assert.match(fnBody('boundarySplatSampleSlot'), /boundarySplatReadSlot\(/);
  for (const name of ['csProjectPressure', 'csProjectPressureTiered']) assert.match(fnBody(name), /let fireLayer = readSlot\(c, 2u\);\n\s*let microLayer = readSlot\(c, 3u\);/, `${name} reads the carriers through the seam`);
  assert.equal([...source.matchAll(/fluidSrc\[base \+ [23]u\]/g)].length, 2, 'the only raw carrier-slot reads left are the converged projection pass-through copies');
  assert.match(source, /splatCamera\.set\(\[gridSize, gridHeight, appearanceModelUniformValue\(controlsSnapshot\.appearanceModel\), 0\], 56\);/, 'the splat camera carries the flag in gridShape.z');
  const copies = [...source.matchAll(/fn expandCompactCarriers\([^]*?\n\}\n/g)].map(m => m[0]);
  assert.equal(copies.length, 2, 'the main module and the splat module (a separate shader) each carry a copy');
  assert.equal(copies[0], copies[1], 'byte-identical');
});

test('under compact-3 the step kernel stores only the three carriers and the front-topology field is reconstructed, not stored', () => {
  assert.match(mainKernel, /let compact = compactAppearanceOn\(\);/);
  assert.match(mainKernel, /fluidDst\[base \+ 2u\] = select\(vec4<f32>\(clamp\(flame, 0\.0, 2\.4\), clamp\(ember, 0\.0, 2\.0\), clamp\(flameDetail, 0\.0, 1\.8\), clamp\(combustionFront, 0\.0, 1\.8\)\), vec4<f32>\(clamp\(flame, 0\.0, 2\.4\), 0\.0, 0\.0, clamp\(combustionFront, 0\.0, 1\.8\)\), compact\);/);
  assert.match(mainKernel, /fluidDst\[base \+ 3u\] = select\(vec4<f32>\(clamp\(microSmoke, 0\.0, 1\.8\), clamp\(interfaceShred, 0\.0, 1\.8\), clamp\(fireLick, 0\.0, 1\.8\), clamp\(emberFleck, 0\.0, 1\.4\)\), vec4<f32>\(0\.0, clamp\(interfaceShred, 0\.0, 1\.8\), 0\.0, 0\.0\), compact\);/);
  assert.match(mainKernel, /frontDst\[idx\] = select\(clamp\(combustionFrontTopology, 0\.0, 2\.0\), 0\.0, compact\);/, 'the separate front field is not stored under compact');
  assert.match(fnBody('readFrontField'), /select\(frontSrc\[index3\(clampCell\(c\)\)\], readSlot\(c, 2u\)\.w \* COMPACT_FRONT_TOPOLOGY_RATIO, compactAppearanceOn\(\)\)/, 'the front field reads as the stored front times its fitted ratio under compact');
});

test('the cockpit carries the Appearance model select; saved basins load on authored; the receipt names the model', () => {
  assert.match(index, /<select id="volume-appearance-model" class="select-input" data-volume-settings-param="volume_appearance_model">\s*<option value="authored">[^<]*<\/option>\s*<option value="compact-3">/);
  assert.match(index, /appearanceModel: document\.getElementById\('volume-appearance-model'\)\.value \|\| 'authored',/);
  assert.match(index, /id="volume-appearance-model-state"/);
  const control = schema.controls.find(c => c.key === 'volume-appearance-model');
  assert.deepEqual(control, { key: 'volume-appearance-model', param: 'volume_appearance_model', tagName: 'SELECT', type: 'select-one', additiveDefault: 'authored', allowedValues: ['authored', 'compact-3'], additiveSinceControlCount: 253 });
  assert.equal(schema.controlCount, 253);
  assert.match(source, /uniforms\[REACTANT_COMBUSTION_UNIFORM_OFFSET \+ 15\] = appearanceModelUniformValue\(controlsSnapshot\.appearanceModel\);/, 'packed in the last borrowed reactant lane (d.w)');
  assert.equal(core.appearanceModelUniformValue('compact-3'), 1);
  assert.equal(core.appearanceModelUniformValue('authored'), 0);
  assert.equal(core.appearanceModelUniformValue(undefined), 0);
  assert.match(source, /state\.appearanceModel = \{ requested: [^}]*, effective: [^}]*\};/);
});
