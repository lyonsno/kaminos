// kaminos-test: node
import './volume-uniform-composition-native.mjs';
import {assertCalibratedFireNumerics} from './helpers/calibrated-fire-native.mjs';
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
  assert.match(source, /uniforms\.set\(reactantCombustionUniformValues\(reactantCombustionConfig\), REACTANT_COMBUSTION_UNIFORM_OFFSET\);\n(?:\s*\/\/.*\n|\s*uniforms\[REACTANT_COMBUSTION_UNIFORM_OFFSET \+ 1[45]\] = [^\n]*;\n|\s*const appearance[A-Za-z]* = [^\n]*;\n|\s*state\.appearanceModel = [^\n]*;\n)*\s*state\.reactantCombustion = reactantCombustionConfig;/, 'the borrowed lanes (quench spread, appearance model) are packed between the block and its receipt');
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
  assert.match(source, /for \(const texture of reactantTextures\) texture\.destroy\(\);\n\s*reactantTextures = \[\];\n\s*reactantSidecarFull = false;/);
});

test('every projection kernel that carries the front carries the sidecar', () => {
  const frontCopies = source.match(/frontDst\[idx\] = frontSrc\[idx\];\n/g)?.length ?? 0;
  const sidecarCopies = source.match(/frontDst\[idx\] = frontSrc\[idx\];\n\s*if \(reactantLawOn\(\)\) \{ textureStore\(reactantDst, vec3<i32>\(gid\), textureLoad\(reactantSrc, vec3<i32>\(gid\), 0\)\); \}/g)?.length ?? 0;
  assert.equal(frontCopies, 3);
  assert.equal(sidecarCopies, frontCopies);
});

test('under the reactant law the fine-box top is a passive outflow for the material: no sponge, no oxygen source at the top', () => {
  assert.match(mainKernel, /let materialVerticalWall = select\(verticalWall, mix\(-p\.y, -1\.0, floorExempt\), reactantOn\);/, 'the top drops out of the material wall sponge');
  assert.match(mainKernel, /let materialHeatTopFade = select\(heatTopFade, 1\.0, reactantOn\);/);
  assert.match(mainKernel, /let materialSmokeTopFade = select\(smokeTopFade, 1\.0, reactantOn\);/);
  assert.match(mainKernel, /smoke = smoke \* stepRate\(mix\(0\.42, 1\.0, materialWallFade\) \* mix\(0\.72, 1\.0, materialSmokeTopFade\)\);/);
  assert.match(mainKernel, /oxidizer = u\.reactant_combustion_c\.z - \(u\.reactant_combustion_c\.z - oxidizer\) \* stepRate\(mix\(0\.20, 1\.0, materialWallFade\) \* mix\(0\.58, 1\.0, materialHeatTopFade\)\);/);
  assert.match(mainKernel, /vel = vel \* stepRate\(mix\(0\.55, 1\.0, materialWallFade\)\);/, 'the flow is not braked under the open top either, or material piles under it');
});

await assertCalibratedFireNumerics();
