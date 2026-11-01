import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(html.includes('id="scene-gi-mode"'), 'operator must be able to select combined AO/GI in the actual scene');
const { resolveSceneGISettings, sceneGIReceives, calibrateSceneGISettingsForBounds } = await import('../scene-gi-settings.mjs');
const defaults = resolveSceneGISettings();
assert.equal(defaults.mode, 'combined');
assert.equal(defaults.gain, 5);
assert.equal(defaults.radius, 20);
assert.equal(defaults.thickness, 7);
assert.equal(defaults.steps, 3);
assert.equal(defaults.slices, 3);
assert.equal(defaults.denoise, 1);
assert.equal(defaults.resolutionScale, 1);
assert.equal(resolveSceneGISettings({resolutionScale:.5}).resolutionScale,.5);
for (const resolutionScale of [0,-1,NaN,Infinity]) assert.throws(()=>resolveSceneGISettings({resolutionScale}));
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
assert.equal(typeof calibrateSceneGISettingsForBounds, 'function', 'bounds-aware SSGI auto-calibration must be exported');
const singleObjectCalibrated = calibrateSceneGISettingsForBounds({
  boxes: [{ min: [-0.577, -0.85, -0.577], max: [0.577, 0.305, 0.577] }],
  cameraDistance: 2.5,
});
assert.ok(singleObjectCalibrated.radius >= 1.0 && singleObjectCalibrated.radius <= 2.0, `single arrived object radius should match object/camera scale, got ${singleObjectCalibrated.radius}`);
assert.ok(singleObjectCalibrated.thickness >= 0.15 && singleObjectCalibrated.thickness <= 0.45, `single arrived object thickness should preserve local crevices, got ${singleObjectCalibrated.thickness}`);
assert.equal(singleObjectCalibrated.estimator.backfaceLighting, 0.2, 'auto-calibrated SSGI keeps default backfaceLighting in physical thin-fill range');
const roomCalibrated = calibrateSceneGISettingsForBounds({
  boxes: [
    { min: [-4, -0.85, -4], max: [4, 4, 4] },
    { min: [-0.577, -0.85, -0.577], max: [0.577, 0.305, 0.577] },
  ],
  cameraDistance: 6.0,
});
assert.ok(roomCalibrated.radius > singleObjectCalibrated.radius * 2, `multi-object room scene expands GI horizon radius, got ${roomCalibrated.radius}`);
assert.ok(roomCalibrated.thickness < 0.6, `multi-object room scene keeps thickness anchored to local prop scale, got ${roomCalibrated.thickness}`);
console.log('scene GI settings and receiver contracts passed');
