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

// EMISSION-01: an admitted source width remains part of domain admission.
const {createKaminosVolumePrototype}=await import('../volume-core.js');
const stub=()=>new Proxy(function(){},{
 get(target,key){if(key===Symbol.toPrimitive)return()=>0;if(key==='then')return undefined;return target[key]??(target[key]=stub());},
 set(target,key,value){target[key]=value;return true;},apply(){return stub();},construct(){return stub();}
});
globalThis.document=stub();globalThis.window=stub();globalThis.requestAnimationFrame=()=>0;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
const prototype=createKaminosVolumePrototype({THREE:stub(),viewport:stub(),camera:stub(),controls:stub(),getControls:()=>({resolution:64}),onStatus:()=>{}});
prototype.setSceneSourceGrid(8);
const before=prototype.debugState(),sourceBefore=prototype.sceneVolumeSourceField();
assert.throws(()=>prototype.validateGridControls({gridHeightRatio:2.0625}),/lighting emission resolution 8.*box aspect/);
assert.throws(()=>prototype.setControls({gridHeightRatio:2.0625}),/lighting emission resolution 8.*box aspect/);
assert.deepEqual(prototype.debugState().simGridDimensions,before.simGridDimensions,'rejected height preserves effective domain');
assert.deepEqual(prototype.debugState().gridHeight,before.gridHeight,'rejected height preserves admitted receipt');
assert.deepEqual(prototype.sceneVolumeSourceField(),sourceBefore,'source request and resource remain unchanged');
prototype.setControls({gridHeightRatio:2.125});
assert.deepEqual(prototype.debugState().simGridDimensions,[64,136,64]);
assert.deepEqual(prototype.setSceneSourceGrid(8).dimensions,[8,17,8]);
console.log('PASS source width participates in domain preflight and compatible edits still work');
