// kaminos-test: node
import assert from 'node:assert/strict';
import {sceneSourceGridPlan,validateSceneSourceGrid} from '../scene-volume-source.mjs';
const limits={maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535};
assert.deepEqual(sceneSourceGridPlan(16,[64,128,64],limits),{resolution:16,dimensions:[16,32,16],cells:8192,materialSamples:65536,bytes:163840,dispatch:[4,8,4]});
assert.equal(sceneSourceGridPlan(32,[64,128,64],limits).cells/sceneSourceGridPlan(16,[64,128,64],limits).cells,8);
assert.deepEqual(sceneSourceGridPlan(24,[64,128,64],limits).dimensions,[24,48,24]);
assert.deepEqual(sceneSourceGridPlan(16,[48,144,48],limits).dimensions,[16,48,16]);
for(const n of [0,-1,1.5,Infinity,NaN])assert.throws(()=>validateSceneSourceGrid(n),/positive integer/);
assert.throws(()=>sceneSourceGridPlan(16,[64,128,64],{maxTextureDimension3D:16}),/device texture limit/);
assert.throws(()=>sceneSourceGridPlan(1,[32,48,32],limits),/box aspect/);
assert.throws(()=>sceneSourceGridPlan(16,[64,128,64],{...limits,maxComputeWorkgroupsPerDimension:4}),/dispatch/);
console.log('PASS independent lighting emission dimensions and actual allocation capacity');
