// kaminos-test: node
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
    emberFleck: [0.111, 0.050, 2.744], microSmoke: [0, 0, 0],
  }, '[flame, shred, front] weights; negatives from the fit are dropped (0). materialDetail is not expanded: it lives in the material slot (1.w) and stays stored under both models');
  assert.match(source, /storedCarriers: appearanceEffective === 'compact-3' \? \['flame', 'interfaceShred', 'combustionFront', 'materialDetail'\] : null/, 'the receipt names materialDetail as stored too');
  const body = fnBody('expandCompactCarriers');
  assert.match(body, /fn expandCompactCarriers\(slot: u32, value: vec4<f32>, flame: f32, shred: f32, front: f32\) -> vec4<f32>/);
  assert.match(body, /if \(!compactAppearanceOn\(\)\) \{ return value; \}/, 'the authored model returns the stored value untouched');
  // One seam per module: the slot read. Every sampler (trilinear, masked,
  // inflow-ghost, splat) and every direct reader goes through it. Under compact
  // the stored form is slot 2 = (flame, shred, 0, front): one load per carrier
  // read, and slot 3 is never loaded (measured: a third load per read cost ~15%
  // at 32³; the stored form takes the traffic to three slots per cell).
  assert.match(fnBody('readSlotWith'), /if \(slot >= 2u && !stored && compactAppearanceOn\(\)\) \{\n\s*let carriers = fluidSrc\[slotIndex\(c, 2u\)\];\n\s*return expandCompactCarriers\(slot, carriers, carriers\.x, carriers\.y, carriers\.w\);/, 'the main module expands from slot 2 alone');
  assert.doesNotMatch(fnBody('readSlotWith'), /slotIndex\(c, 3u\)/, 'no slot-3 load on the compact path');
  assert.match(fnBody('readSlot'), /return readSlotWith\(c, slot, false\);/);
  assert.match(fnBody('readPredictSlot'), /let carriers = fluidPredict\[slotIndex\(c, 2u\)\];\n\s*return expandCompactCarriers\(slot, carriers, carriers\.x, carriers\.y, carriers\.w\);/, 'the predict buffer carries the stored form and expands on read');
  assert.match(fnBody('boundarySplatReadSlot'), /let carriers = fluid\[base \+ 2u\];\n\s*return expandCompactCarriers\(slot, carriers, carriers\.x, carriers\.y, carriers\.w\);/, 'the splat module expands from slot 2 alone');
  for (const name of ['sampleFluidSlotWith', 'sampleFluidSlotMaskedWith']) assert.match(fnBody(name), /readSlotWith\([^;]*, stored\)/, `${name} reads through the seam, carrying the stored flag`);
  for (const name of ['sampleFluidSlot', 'sampleFluidSlotMasked', 'sampleFluidSlotInflow']) assert.match(fnBody(name), new RegExp(`return ${name}With\\(cellCenter, slot, false\\);`), `${name} is the expanded read`);
  assert.match(fnBody('boundarySplatSampleSlot'), /boundarySplatReadSlot\(/);
  for (const name of ['csProjectPressure', 'csProjectPressureTiered']) {
    const body = fnBody(name);
    assert.match(body, /let fireLayer = readSlot\(c, 2u\);\n\s*let microLayer = readSlot\(c, 3u\);/, `${name} reads the carriers through the seam`);
    assert.match(body, /if \(compactAppearanceOn\(\)\) \{\n\s*fluidDst\[base \+ 2u\] = fluidSrc\[base \+ 2u\];\n\s*\} else \{\n\s*fluidDst\[base \+ 2u\] = fireLayer;\n\s*fluidDst\[base \+ 3u\] = microLayer;\n\s*\}/, `${name} passes the stored form through and does not touch slot 3 under compact`);
  }
  assert.match(fnBody('csProjectPressureConverged'), /if \(!compactAppearanceOn\(\)\) \{ fluidDst\[base \+ 3u\] = fluidSrc\[base \+ 3u\]; \}/);
  assert.match(fnBody('macCormackSlot'), /let predicted = readPredictSlot\(c, slot\);/, 'the corrector takes the expanded prediction');
  assert.match(fnBody('macCormackSlot'), /let current = readSlot\(c, slot\);/, 'the corrector compares against the expanded current, not the stored form');
  assert.match(fnBody('csTransportPredict'), /if \(compactAppearanceOn\(\)\) \{[^}]*fluidPredict\[base \+ 2u\] = sampleFluidSlotInflowWith\(backCell, 2u, true\);\n\s*return;/, 'the predictor carries the stored form and predicts three slots under compact');
  assert.equal([...source.matchAll(/fluidSrc\[base \+ [23]u\]/g)].length, 6, 'raw carrier-slot reads: the two projection pass-throughs, the converged pass-through pair, the relayout pair');
  assert.match(source, /splatCamera\.set\(\[gridSize, gridHeight, appearanceModelUniformValue\(state\.appearanceModel\?\.effective\), 0\], 56\);/, 'the splat camera carries the flag in gridShape.z');
  const copies = [...source.matchAll(/fn expandCompactCarriers\([^]*?\n\}\n/g)].map(m => m[0]);
  assert.equal(copies.length, 2, 'the main module and the splat module (a separate shader) each carry a copy');
  assert.equal(copies[0], copies[1], 'byte-identical');
});

test('under compact-3 the step kernel stores the three carriers in slot 2, never writes slot 3, and the front-topology field is reconstructed, not stored', () => {
  assert.match(mainKernel, /let compact = compactAppearanceOn\(\);/);
  assert.match(mainKernel, /if \(compact\) \{\n\s*fluidDst\[base \+ 2u\] = vec4<f32>\(clamp\(flame, 0\.0, 2\.4\), clamp\(interfaceShred, 0\.0, 1\.8\), 0\.0, clamp\(combustionFront, 0\.0, 1\.8\)\);\n\s*\} else \{\n\s*fluidDst\[base \+ 2u\] = vec4<f32>\(clamp\(flame, 0\.0, 2\.4\), clamp\(ember, 0\.0, 2\.0\), clamp\(flameDetail, 0\.0, 1\.8\), clamp\(combustionFront, 0\.0, 1\.8\)\);\n\s*fluidDst\[base \+ 3u\] = vec4<f32>\(clamp\(microSmoke, 0\.0, 1\.8\), clamp\(interfaceShred, 0\.0, 1\.8\), clamp\(fireLick, 0\.0, 1\.8\), clamp\(emberFleck, 0\.0, 1\.4\)\);\n\s*\}/);
  assert.equal([...mainKernel.matchAll(/fluidDst\[base \+ 3u\]/g)].length, 1, 'the only slot-3 store in the step kernel is the authored one');
  assert.match(mainKernel, /frontDst\[idx\] = select\(clamp\(combustionFrontTopology, 0\.0, 2\.0\), 0\.0, compact\);/, 'the separate front field is not stored under compact');
  assert.match(fnBody('readFrontField'), /select\(frontSrc\[index3\(clampCell\(c\)\)\], readSlot\(c, 2u\)\.w \* COMPACT_FRONT_TOPOLOGY_RATIO, compactAppearanceOn\(\)\)/, 'the front field reads as the stored front times its fitted ratio under compact');
});

test('switching the model converts the stored form once (relayout pass), so the buffer never holds one form while the seam reads the other', () => {
  const relayout = fnBody('csAppearanceRelayout');
  assert.match(relayout, /^fn csAppearanceRelayout\(@builtin\(global_invocation_id\) gid: vec3<u32>\) \{\n  seatGridShape\(\);/);
  assert.match(relayout, /if \(compactAppearanceOn\(\)\) \{\n\s*let micro = fluidSrc\[base \+ 3u\];\n\s*fluidDst\[base \+ 2u\] = vec4<f32>\(fire\.x, micro\.y, 0\.0, fire\.w\);\n\s*frontDst\[idx\] = 0\.0;/, 'authored -> compact keeps flame, shred, front');
  assert.match(relayout, /fluidDst\[base \+ 2u\] = expandCompactCarriers\(2u, fire, fire\.x, fire\.y, fire\.w\);\n\s*fluidDst\[base \+ 3u\] = expandCompactCarriers\(3u, fire, fire\.x, fire\.y, fire\.w\);\n\s*frontDst\[idx\] = clamp\(fire\.w \* COMPACT_FRONT_TOPOLOGY_RATIO, 0\.0, 2\.0\);/, 'compact -> authored expands the dropped carriers and the front field');
  assert.match(relayout, /if \(reactantLawOn\(\)\) \{ textureStore\(reactantDst/, 'the reactant sidecar follows the flip');
  const host = source.slice(source.indexOf('  function ensureAppearanceLayout('), source.indexOf('  function encodeSim('));
  assert.match(host, /const wanted = state\.appearanceModel\?\.effective \?\? 'authored';\n\s*if \(wanted === fluidLayoutInForce\) return false;/);
  assert.match(host, /currentFluid = 1 - currentFluid;\n\s*currentFront = 1 - currentFront;/, 'the pass writes the other buffer and flips like a step');
  assert.match(host, /fluidLayoutInForce = wanted;/);
  assert.match(source, /function encodeSim\(encoder, options = \{\}\) \{\n[\s\S]{0,500}?\n\s*refreshSceneCollision\(\);\n\s*ensureAppearanceLayout\(encoder\);/, 'every step starts by seating the layout');
  assert.equal([...source.matchAll(/(?<!let )fluidLayoutInForce = 'authored';/g)].length, 2, 'grid rebuild and full-field import both write the authored form');
  assert.match(source, /entryPoint: 'csAppearanceRelayout', constants: computePipelineConstants/);
  assert.match(source, /storedSlots: appearanceEffective === 'compact-3' \? 3 : 4, layout: fluidLayoutInForce \}/, 'the receipt names the stored slot count and the layout in force');
});

test('the cockpit carries the Appearance model select; saved basins load on authored; the receipt names the model', () => {
  assert.match(index, /<select id="volume-appearance-model" class="select-input" data-volume-settings-param="volume_appearance_model">\s*<option value="authored">[^<]*<\/option>\s*<option value="compact-3">/);
  assert.match(index, /appearanceModel: document\.getElementById\('volume-appearance-model'\)\.value \|\| 'authored',/);
  assert.match(index, /id="volume-appearance-model-state"/);
  const control = schema.controls.find(c => c.key === 'volume-appearance-model');
  assert.deepEqual(control, { key: 'volume-appearance-model', param: 'volume_appearance_model', tagName: 'SELECT', type: 'select-one', additiveDefault: 'authored', allowedValues: ['authored', 'compact-3'], additiveSinceControlCount: 256 });
  assert.equal(schema.controlCount, 143);
  assert.match(source, /const appearanceEffective = appearanceRequested === 'compact-3' && reactantCombustionConfig\.effective\.admitted \? 'compact-3' : 'authored';\n\s*uniforms\[REACTANT_COMBUSTION_UNIFORM_OFFSET \+ 15\] = appearanceModelUniformValue\(appearanceEffective\);/, 'packed in the last borrowed reactant lane (d.w); compact-3 is effective only under the admitted reactant law (under the authored law the dropped carriers feed the reaction)');
  assert.match(source, /reason: appearanceRequested === 'compact-3' && appearanceEffective !== 'compact-3' \? 'compact-3-requires-the-reactant-law' : null/, 'the receipt names the refusal');
  assert.match(source, /splatCamera\.set\(\[gridSize, gridHeight, appearanceModelUniformValue\(state\.appearanceModel\?\.effective\), 0\], 56\);/, 'the splat lane follows the effective model');
  assert.equal(core.appearanceModelUniformValue('compact-3'), 1);
  assert.equal(core.appearanceModelUniformValue('authored'), 0);
  assert.equal(core.appearanceModelUniformValue(undefined), 0);
  assert.match(source, /state\.appearanceModel = \{ requested: appearanceRequested, effective: appearanceEffective, reason: [^\n]*storedCarriers: [^\n]*\};/);
});
