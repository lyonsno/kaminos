// kaminos-test: node
import assert from 'node:assert/strict';
import {applySceneEmissiveCamera} from '../scene-emissive-camera.mjs';

const raw={name:'linear scene'},matched={name:'display scene'};
const scene={outputNode:matched,outputColorTransform:false,needsUpdate:false};
const water={outputNode:raw,outputColorTransform:true,needsUpdate:false};

// A display node performs its own camera transform. Disabling the pipeline's
// automatic transform alone cannot turn that node back into linear radiance.
applySceneEmissiveCamera(scene,raw,matched,true,{linearIntermediate:true});
assert.equal(scene.outputNode,raw,'water must sample the raw scene, never the matched display node');
assert.equal(scene.outputColorTransform,false,'no display transform before water refraction');
assert.equal(scene.needsUpdate,true);
applySceneEmissiveCamera(water,raw,matched,true);
assert.equal(water.outputNode,matched,'the composed water image receives the matched camera');
assert.equal(water.outputColorTransform,false,'matched display already includes transfer to sRGB');

scene.needsUpdate=false;
applySceneEmissiveCamera(scene,raw,matched,true,{linearIntermediate:true});
assert.equal(scene.needsUpdate,false,'an unchanged linear input does not rebuild every frame');

// Matching off and GI diagnostic views still require a linear scene input.
applySceneEmissiveCamera(scene,raw,matched,false,{linearIntermediate:true});
assert.equal(scene.outputNode,raw);
assert.equal(scene.outputColorTransform,false);
applySceneEmissiveCamera(water,raw,matched,false);
assert.equal(water.outputNode,raw);
assert.equal(water.outputColorTransform,true,'ordinary host camera is applied once at presentation');

// Removing water restores the ordinary scene-camera route.
applySceneEmissiveCamera(scene,raw,matched,true);
assert.equal(scene.outputNode,matched);
assert.equal(scene.outputColorTransform,false);
applySceneEmissiveCamera(scene,raw,matched,false);
assert.equal(scene.outputNode,raw);
assert.equal(scene.outputColorTransform,true);
console.log('local liquid display-camera ordering contracts passed');
