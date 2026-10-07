import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(html.includes('id="scene-gi-mode"'), 'operator must be able to select combined AO/GI in the actual scene');
const { resolveSceneGISettings, sceneGIReceives } = await import('../scene-gi-settings.mjs');
const defaults = resolveSceneGISettings();
assert.equal(defaults.mode, 'gtao');
assert.equal(defaults.gain, 10);
assert.equal(resolveSceneGISettings({gain:1}).gain,1,'authored gain remains authoritative');
assert.equal(defaults.view, 'scene');
assert.deepEqual(resolveSceneGISettings({futureQuality:'x'}),defaults,'additive scene fields must not become DOM control IDs');
const shader = readFileSync(new URL('../scene-gi.mjs', import.meta.url), 'utf8');
assert.match(shader,/diffuseColor\.rgb\.mul\(metalness\.oneMinus\(\)\)/,'diffuse bounce must suppress metallic response');
assert.deepEqual(resolveSceneGISettings(JSON.parse(JSON.stringify(defaults))), defaults);
assert.equal(resolveSceneGISettings({gain:0}).gain, 0);
assert.equal(resolveSceneGISettings({slices:8,steps:64,radius:80}).steps, 64, 'no hidden quality cap');
for(const value of [{mode:'unknown'}, {view:'unknown'}, {gain:NaN}, {radius:0}, {steps:0}, {slices:1.5}]) {
  assert.throws(()=>resolveSceneGISettings(value));
}
assert.equal(sceneGIReceives({isMeshStandardNodeMaterial:true}),true);
assert.equal(sceneGIReceives({isMeshPhysicalNodeMaterial:true}),true);
assert.equal(sceneGIReceives({isMeshStandardMaterial:true}),true);
assert.equal(sceneGIReceives({isMeshPhysicalMaterial:true}),true);
assert.equal(resolveSceneGISettings({view:'incoming'}).view,'incoming');
assert.equal(sceneGIReceives({isMeshStandardNodeMaterial:true,transparent:true}),false);
assert.equal(sceneGIReceives({isMeshBasicNodeMaterial:true}),false);
console.log('scene GI settings and receiver contracts passed');
