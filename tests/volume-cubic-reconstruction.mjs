import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(core, /CUBIC_RECONSTRUCTION_WGSL/, 'camera renderer must install the cubic reconstruction implementation');
const { catmullRomWeights, CUBIC_RECONSTRUCTION_WGSL } = await import('../volume-cubic-reconstruction.mjs');
for (const t of [0, .125, .5, .875, 1]) {
  const weights = catmullRomWeights(t);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
  near(weights.reduce((a, b) => a + b), 1);
  near(weights.reduce((a, b, i) => a + b * (i - 1), 0), t);
}
assert.deepEqual(catmullRomWeights(0), [0, 1, 0, 0]);
assert.deepEqual(catmullRomWeights(1), [0, 0, 1, 0]);
assert.deepEqual(catmullRomWeights(.5), [-.0625, .5625, .5625, -.0625]);
assert.match(CUBIC_RECONSTRUCTION_WGSL, /f32\(GRID_Y\) - 1\.001/, 'tall grid has its own Y extent');
assert.match(CUBIC_RECONSTRUCTION_WGSL, /return clamp\(value, lo, hi\)/, 'cubic cannot create negative scalars, emission peaks or support outside the central cell range');
assert.match(CUBIC_RECONSTRUCTION_WGSL, /x >= 1 && x <= 2 && y >= 1 && y <= 2 && z >= 1 && z <= 2/, 'range limit uses exactly the existing eight-cell support');
assert.match(core, /uniforms\[45\] = controlsSnapshot\.raymarchInterpolation === 'cubic' \? 1 : 0/, 'host sends explicit cubic choice in a reserved render lane');
assert.match(page, /id="volume-raymarch-interpolation"[^>]*data-volume-settings-role="renderer"/);
assert.match(page, /raymarchInterpolation: document\.getElementById\('volume-raymarch-interpolation'\)\.value/);
assert.match(page, /\['raymarchInterpolation', 'volume_raymarch_interpolation'\]/);
const raw = balancedWgslBlock(core, 'fn sampleWorldFlowReconstructionRaw(');
assert.doesNotMatch(raw, /[Cc]ubic|[Cc]amera/, 'shared transport sampler remains trilinear');
const producer = readFileSync(new URL('../volume-emissive-transport.mjs', import.meta.url), 'utf8');
assert.match(producer, /sampleWorldFlowReconstructionRaw/);
assert.doesNotMatch(producer, /[Cc]ubic|sampleWorldCamera/, 'light producer must not consume presentation interpolation');
assert.match(core, /let center = sampleWorldCameraSidecar\(p\)/, 'baked boundary consumer uses selected interpolation');
assert.match(core, /liveCameraBoundarySupportAt\(p \+ boundaryDx/, 'live boundary consumer uses selected interpolation');
assert.match(core, /if \(fullGridCapture\) \{\s*reconstructed = sampleWorldFlowReconstructionRaw\(p\)/, 'full-grid diagnostics retain native linear field semantics');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url)));
assert.deepEqual(schema.rendererControls.find(row => row.key === 'volume-raymarch-interpolation').allowedValues, ['linear', 'cubic']);
assert.equal(schema.rendererControls.find(row => row.key === 'volume-raymarch-interpolation').additiveDefault, 'linear');
console.log('cubic reconstruction weights, support, camera/producer and persistence contracts passed');
