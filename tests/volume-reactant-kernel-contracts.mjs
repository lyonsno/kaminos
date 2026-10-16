// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const mainKernel = (() => { const start = source.indexOf('fn cs(@builtin(global_invocation_id) gid: vec3<u32>) {'); return source.slice(start, source.indexOf('\n}\n', start)); })();
// Every `if (reactantOn) {` block of the main kernel, braces balanced.
const reactantBlocks = (() => {
  const blocks = [];
  let at = 0;
  for (;;) {
    const start = mainKernel.indexOf('if (reactantOn) {', at);
    if (start < 0) return blocks;
    let depth = 0;
    let i = mainKernel.indexOf('{', start);
    for (; i < mainKernel.length; i += 1) {
      if (mainKernel[i] === '{') depth += 1;
      else if (mainKernel[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    blocks.push(mainKernel.slice(start, i + 1));
    at = i + 1;
  }
})();

test('the reactant uniform block follows the immersed source and is packed and receipted every frame', () => {
  assert.equal(core.REACTANT_COMBUSTION_UNIFORM_OFFSET, core.GRID_SHAPE_UNIFORM_OFFSET + core.GRID_SHAPE_UNIFORM_FLOATS, 'after the grid shape block');
  assert.equal(core.REACTANT_COMBUSTION_UNIFORM_FLOATS, 16);
  // The joined-boundary block (Flame Doctor) follows the reactant block.
  assert.equal(core.JOINED_BOUNDARY_UNIFORM_OFFSET, core.REACTANT_COMBUSTION_UNIFORM_OFFSET + 16);
  assert.equal(core.VOLUME_UNIFORM_FLOATS % 4, 0);
  assert.match(source, /grid_shape_b: vec4<f32>,\n(?:\s*\/\/.*\n)*\s*reactant_combustion_a: vec4<f32>,\n\s*reactant_combustion_b: vec4<f32>,\n\s*reactant_combustion_c: vec4<f32>,\n\s*reactant_combustion_d: vec4<f32>,\n\s*joined_boundary: vec4<f32>,\n\s*joined_ghost_geometry: vec4<f32>,\n\s*joined_ghost_dims: vec4<f32>,\n\s*wavelet_turbulence: vec4<f32>,\n\};/, 'the struct carries the block right after the grid shape');
  assert.match(source, /uniforms\.set\(reactantCombustionUniformValues\(reactantCombustionConfig\), REACTANT_COMBUSTION_UNIFORM_OFFSET\);\s*\n\s*state\.reactantCombustion = reactantCombustionConfig;/);
  assert.match(source, /resolveReactantCombustionConfig\(controlsSnapshot, \{\s*grid: gridSize,\s*transportCommonCharacteristic: resolveTransportConfig\(controlsSnapshot\)\.effective\.commonCharacteristic,/, 'admission sees the effective transport');
});

test('the oxidizer sidecar is two compute-only textures, read sampled and written as storage', () => {
  assert.match(source, /@group\(0\) @binding\(23\) var reactantSrc: texture_3d<f32>;/);
  assert.match(source, /@group\(0\) @binding\(24\) var reactantDst: texture_storage_3d<rg32float, write>;/);
  assert.match(source, /\{ binding: 23, visibility: GPUShaderStage\.COMPUTE, texture: \{ sampleType: 'unfilterable-float', viewDimension: '3d' \} \},/);
  assert.match(source, /\{ binding: 24, visibility: GPUShaderStage\.COMPUTE, storageTexture: \{ access: 'write-only', format: 'rg32float', viewDimension: '3d' \} \},/);
  assert.doesNotMatch(source, /var<storage[^>]*> reactant/, 'no new storage buffer: the compute stage is at its storage-buffer limit');
  assert.match(source, /\{ binding: 23, resource: reactantRead\.createView\(\{ dimension: '3d' \}\) \},\n\s*\{ binding: 24, resource: reactantWrite\.createView\(\{ dimension: '3d' \}\) \},/);
  assert.match(source, /reactantRead: reactantTextures\[fluidIndex\],\n\s*reactantWrite: reactantTextures\[1 - fluidIndex\],/, 'the sidecar ping-pongs with the fluid');
  assert.match(source, /reactantRead = reactantTextures\[0\],\n\s*reactantWrite = reactantTextures\[1\],/, 'read and write are always distinct textures');
});

test('the sidecar is full size only while the law is admitted, starts as ambient air, and follows uploads and teardown', () => {
  assert.match(source, /const size = admitted \? \[gridSize, gridHeight, gridSize\] : \[1, 1, 1\];/);
  assert.match(source, /format: 'rg32float',/);
  assert.match(source, /for \(let i = 0; i < texels\.length; i \+= 2\) texels\[i\] = REACTANT_MODEL\.ambientOxidizer;/);
  assert.match(source, /if \(ensureReactantSidecar\(reactantCombustionConfig\.effective\.admitted\)\) \{\s*\n\s*rebuildFluidBindGroups\(\);\s*\n\s*rebuildSceneSolidBindingViews\(\);\s*\n\s*rebuildSelectiveHeadLiveBindGroups\(\);/, 'a reallocated sidecar rebuilds every bind group that carries it');
  assert.match(source, /for \(const texture of reactantTextures\) texture\.destroy\(\);\n\s*reactantTextures = \[\];\n\s*reactantSidecarFull = false;/);
  assert.equal(source.match(/resetReactantSidecarToAmbient\(\);/g)?.length, 2, 'both fluid uploads (replay anchor, debug import) reset the oxidizer');
});

test('every projection kernel that carries the front carries the sidecar', () => {
  const frontCopies = source.match(/frontDst\[idx\] = frontSrc\[idx\];\n/g)?.length ?? 0;
  const sidecarCopies = source.match(/frontDst\[idx\] = frontSrc\[idx\];\n\s*if \(reactantLawOn\(\)\) \{ textureStore\(reactantDst, vec3<i32>\(gid\), textureLoad\(reactantSrc, vec3<i32>\(gid\), 0\)\); \}/g)?.length ?? 0;
  assert.equal(frontCopies, 3);
  assert.equal(sidecarCopies, frontCopies);
});

test('the main kernel burns once, locally, through the module law', () => {
  assert.match(mainKernel, /let burn = reactantBurn\(fuel, oxidizer, heat, timeStep\);/);
  assert.match(mainKernel, /oxidizer = transportReactantOxidizer\(cellI, backCell, reactantForwardCell, macCormackScalars\);/, 'oxidizer rides the fuel characteristic and scheme');
  assert.match(mainKernel, /let exchange = sampleReactantExchangeLaplacian\(backCell\);/, 'exchange then advect: the exchange is sampled at the departure point, not added at the arrival cell (lagged)');
  assert.doesNotMatch(mainKernel, /reactantExchangeLaplacian\(cellI\)/);
  assert.ok(reactantBlocks.length >= 5, `found ${reactantBlocks.length} reactant blocks`);
  for (const block of reactantBlocks) {
    assert.doesNotMatch(block, /fireLick|flame|Flame|ember|memory|Memory|shred|Shred|detail|Detail|front|Front|fleck|NormalizedFlameHeight|AboveSource|p\.y/, `no appearance field or box position in a reactant block:\n${block}`);
  }
});

test('under the reactant law the authored reaction terms yield to the single burn and appearance is fed one way', () => {
  assert.match(mainKernel, /let smokeFromHeat = select\(heatToSmokeConversion\(heat, fuel, p\.y\), u\.reactant_combustion_b\.z \* reactantFreshBurnRate, reactantOn\);/, 'soot from the burn, no smoke from heat');
  assert.match(mainKernel, /let tallPlumePilotReaction = select\(authoredTallPlumePilotReaction, 0\.0, reactantOn\);/, 'no memory pilot');
  assert.match(mainKernel, /let tallPlumeFuelHeatReaction = select\(tallPlumeScene \* max\(tallPlumeLiveReaction, tallPlumePilotReaction\), tallPlumeScene \* \(1\.0 - exp\(-reactantFreshBurnRate \/ max\(u\.reactant_combustion_d\.x, 1e-6\)\)\), reactantOn\);/, 'the appearance reaction signal is the fresh burn');
  assert.match(mainKernel, /let fuelConsumption = select\(tallPlumeFuelHeatReaction \* \(0\.012 \+ inputFlow \* 0\.010 \+ fireLickAmount \* 0\.002\) \+ tallPlumePilotReaction \* 0\.006, reactantFreshBurnRate, reactantOn\);/, 'Fire Licks no longer reaches consumption under the candidate');
  assert.match(mainKernel, /let tallPlumeReactionSmokeBirth = select\([^\n]*, 0\.0, reactantOn\);/);
  assert.match(mainKernel, /if \(!reactantOn\) \{\n\s*heat = heat \+ \(tallPlumeFuelHeatReaction \* mix\(0\.0, 0\.16, tallPlumeScene\) \+ tallPlumePilotReaction \* 0\.030\) \* timeStep;\n\s*\}/, 'the authored heat release runs only under the authored law');
  assert.match(mainKernel, /if \(reactantOn\) \{[^}]*textureStore\(burnRate, cellI, vec4<f32>\(u\.heat_release\.x \* reactantFreshBurnRate \+ immersedTarget, 0\.0, 0\.0, 0\.0\)\);\n\s*\} else \{\n\s*let fuelBurnRate = heat \* 0\.018 \+ fuelConsumption;/, 'expansion follows the same burned amount and gain; the authored burn is the else branch');
  assert.match(mainKernel, /let tallPlumeNormalizedFlameHeight = select\(clamp\(\(p\.y \+ 0\.84\) \/ 1\.58, 0\.0, 1\.0\), 0\.0, reactantOn\);/, 'no box-height survival demand under the candidate');
  assert.match(mainKernel, /oxidizer = mix\(oxidizer, u\.reactant_combustion_c\.w, inflowFraction\);/, 'the inflow brings the stream oxidizer');
  assert.match(mainKernel, /oxidizer = mix\(oxidizer, u\.reactant_combustion_c\.w, immersedEntry\);/);
  assert.match(mainKernel, /oxidizer = u\.reactant_combustion_c\.z - \(u\.reactant_combustion_c\.z - oxidizer\) \* stepRate\(mix\(0\.20, 1\.0, materialWallFade\) \* mix\(0\.58, 1\.0, materialHeatTopFade\)\);/, 'sponges relax oxidizer toward ambient air');
  assert.match(mainKernel, /if \(reactantOn\) \{\n\s*textureStore\(reactantDst, cellI, vec4<f32>\(clamp\(oxidizer, 0\.0, 2\.0\), reactantFreshBurnRate, 0\.0, 0\.0\)\);\n\s*\}/);
});

test('under the reactant law the volumetric emitter births no heat or fuel: supply enters only through the inflow and immersed entries', () => {
  assert.match(mainKernel, /heat = max\(heat, select\(mix\(mix\(mix\(columnHeatBirth, tallPlumeHeatBirth, tallPlumeScene\), canonicalHeatBirth, canonicalPlumeScene\), bonfireHeatBirth, bonfireScene\), 0\.0, reactantOn\)\);/, 'no height-masked, oxidizer-free heat birth');
  assert.match(mainKernel, /fuel = max\(fuel, select\(mix\(tallPlumeFuelInjection, bonfireInjectedFuel, bonfireScene\), 0\.0, reactantOn\)\);/, 'no height-masked fuel injection without oxidizer accounting');
  assert.match(mainKernel, /let columnSmokeBirthForScene = select\(mix\(columnSmokeBirth, tallPlumeSmokeBirth, tallPlumeScene\), 0\.0, reactantOn\);/, 'soot only from the burned amount');
  for (const [field, channel, gain] of [['smoke', 'x', '0\\.76'], ['heat', 'y', '0\\.92'], ['fuel', 'z', '0\\.72']]) {
    assert.match(mainKernel, new RegExp(`${field} = max\\(${field}, select\\(externalInjection\\.material\\.${channel} \\* ${gain}, 0\\.0, reactantOn\\)\\);`), `external emitters inject no ${field} under the candidate (no oxidizer accounting)`);
  }
});

test('under the reactant law the fine-box top is a passive outflow for the material: no sponge, no oxygen source at the top', () => {
  assert.match(mainKernel, /let materialVerticalWall = select\(verticalWall, mix\(-p\.y, -1\.0, floorExempt\), reactantOn\);/, 'the top drops out of the material wall sponge');
  assert.match(mainKernel, /let materialHeatTopFade = select\(heatTopFade, 1\.0, reactantOn\);/);
  assert.match(mainKernel, /let materialSmokeTopFade = select\(smokeTopFade, 1\.0, reactantOn\);/);
  assert.match(mainKernel, /smoke = smoke \* stepRate\(mix\(0\.42, 1\.0, materialWallFade\) \* mix\(0\.72, 1\.0, materialSmokeTopFade\)\);/);
  assert.match(mainKernel, /heat = heat \* stepRate\(mix\(0\.30, 1\.0, materialWallFade\) \* mix\(0\.16, 1\.0, materialHeatTopFade\)\);/);
  assert.match(mainKernel, /fuel = fuel \* stepRate\(mix\(0\.20, 1\.0, materialWallFade\) \* mix\(0\.58, 1\.0, materialHeatTopFade\)\);/);
  assert.match(mainKernel, /oxidizer = u\.reactant_combustion_c\.z - \(u\.reactant_combustion_c\.z - oxidizer\) \* stepRate\(mix\(0\.20, 1\.0, materialWallFade\) \* mix\(0\.58, 1\.0, materialHeatTopFade\)\);/);
  assert.match(mainKernel, /flame = flame \* stepRate\(mix\(0\.12, 1\.0, wallFade\) \* mix\(0\.08, 1\.0, fireTopFade\)\);/, 'appearance keeps its own fades');
  assert.match(mainKernel, /vel = vel \* stepRate\(mix\(0\.55, 1\.0, materialWallFade\)\);/, 'the flow is not braked under the open top either, or material piles under it');
});

test('the authored law is untouched when the candidate is not admitted', () => {
  const authoredLines = [
    'var smoke = material.x * stepRate(0.990);',
    'var heat = material.y * stepRate(0.982);',
    'var fuel = material.z * stepRate(0.990);',
    'let fuelBurned = min(fuel, fuelBurnRate * timeStep);',
    'textureStore(burnRate, cellI, vec4<f32>(u.heat_release.x * fuelBurned / max(timeStep, 1e-6) + immersedTarget, 0.0, 0.0, 0.0));',
    'smoke = smoke + tallPlumeReactionSmokeBirth * timeStep;',
  ];
  for (const line of authoredLines) assert.ok(mainKernel.includes(line), line);
  assert.deepEqual(core.reactantCombustionUniformValues(core.resolveReactantCombustionConfig({})), new Array(16).fill(0), 'zero uniforms keep reactantLawOn() false');
});

test('the cockpit carries the Reaction Law select and the two candidate controls, and saved basins load on the authored law', () => {
  assert.match(index, /<select id="volume-reaction-law" class="select-input" data-volume-settings-param="volume_reaction_law">\s*<option value="authored-tall-plume">[^<]*<\/option>\s*<option value="reactant-v0">/);
  assert.match(index, /id="volume-reactant-mixing-time" data-volume-settings-param="volume_reactant_mixing_time" min="0\.25" max="30"/);
  assert.match(index, /id="volume-reactant-cooling-time" data-volume-settings-param="volume_reactant_cooling_time" min="5" max="300"/);
  assert.match(index, /reactionLaw: document\.getElementById\('volume-reaction-law'\)\.value \|\| 'authored-tall-plume',/);
  assert.match(index, /reactantMixingTime: parseFloat\(document\.getElementById\('volume-reactant-mixing-time'\)\.value\),/);
  assert.match(index, /reactantCoolingTime: parseFloat\(document\.getElementById\('volume-reactant-cooling-time'\)\.value\),/);
  assert.match(index, /id="volume-reaction-law-state"/);
  assert.match(index, /NOT ADMITTED \(\$\{reactant\.effective\.reason\}\); the authored law runs/);
  const restored = index.match(/const VOLUME_ROUTE_RESTORED_CONTROL_IDS = \[([^\]]*)\]/)[1];
  for (const id of ['volume-reaction-law', 'volume-reactant-mixing-time', 'volume-reactant-cooling-time']) assert.ok(restored.includes(`'${id}'`), `${id} restores from the route`);
  const byKey = Object.fromEntries(schema.controls.map(c => [c.key, c]));
  assert.equal(schema.controlCount, schema.controls.length);
  assert.equal(byKey['volume-reaction-law'].additiveDefault, 'authored-tall-plume', 'a basin saved before the candidate loads on the authored law');
  assert.deepEqual(byKey['volume-reaction-law'].allowedValues, ['authored-tall-plume', 'reactant-v0']);
  assert.equal(byKey['volume-reactant-mixing-time'].additiveDefault, 3, 'the slider default is the module default');
  assert.match(index, /id="volume-reactant-mixing-time"[^>]*value="3">/);
  assert.equal(byKey['volume-reactant-cooling-time'].additiveDefault, 55.06);
});
