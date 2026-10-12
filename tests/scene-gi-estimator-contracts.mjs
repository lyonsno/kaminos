import assert from 'node:assert/strict';
import * as settings from '../scene-gi-settings.mjs';

assert.equal(typeof settings.resolveSceneGIEstimatorSettings, 'function', 'underlying estimator controls need a validated public setter');
const resolve = settings.resolveSceneGIEstimatorSettings;
const defaults = resolve();
assert.deepEqual(defaults, {expFactor:2,screenSpaceSampling:false,linearThickness:false,backfaceLighting:0,depthPhi:.1,normalPhi:5,lumaPhi:5});
assert.deepEqual(resolve(JSON.parse(JSON.stringify(defaults))), defaults);
assert.equal(resolve({expFactor:4,depthPhi:.001}).expFactor,4);
for (const value of [{expFactor:0},{depthPhi:0},{normalPhi:NaN},{lumaPhi:Infinity},{screenSpaceSampling:1},{linearThickness:'false'},{backfaceLighting:-1}]) assert.throws(() => resolve(value));
assert.deepEqual(resolve({futureField:1}),defaults,'additive unknown fields remain compatible');
assert.equal(settings.resolveSceneGISettings({slices:16,steps:128}).steps,128,'quality counts remain uncapped');
console.log('Underlying GI estimator settings pass');
