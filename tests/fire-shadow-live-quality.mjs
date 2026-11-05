// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFireLightFieldShadow} from '../fire-light-field-shadow.mjs';
const shadow=createFireLightFieldShadow({renderer:{backend:{device:{limits:{maxTextureDimension2D:8192}}}},scene:{},sourceNode:THREE.TSL.vec3(0),receiverNode:THREE.TSL.vec3(0,0,4),normalNode:THREE.TSL.vec3(0,0,-1),sourceSizeNode:THREE.TSL.float(.5),runtimeQuality:true,shadowSoftness:1,blockerSamples:2,filterSamples:2,resolution:128});
assert.equal(typeof shadow.setQuality,'function','quality edits need a live uniform/resource path');
const graph=shadow.visibility;
assert.equal(shadow.debugState().filterPattern.route,'runtime-arithmetic');assert.equal(shadow.debugState().filterPattern.bytes,0);
for(const q of [{resolution:64},{resolution:65},{resolution:96},{resolution:256},{resolution:32},{blockerSamples:3},{filterSamples:7},{resolution:128,blockerSamples:2,filterSamples:2}]){
  shadow.setQuality(q);
  assert.equal(shadow.visibility,graph,'quality must retain the same receiving shader graph');
  for(const [k,v] of Object.entries(q))assert.equal(shadow.debugState()[k],v);
  const faces=shadow.resource().colorTexture.image;
  assert.equal(faces.length,6);
  for(const face of faces){
    assert.equal(face.width,shadow.debugState().resolution,'all cube face images must follow live resolution');
    assert.equal(face.height,shadow.debugState().resolution,'all cube face images must follow live resolution');
  }
  assert.equal(shadow.debugState().effective,false,'a resized cube cannot be sampled before recapture');
  assert.equal(shadow.resource().texture,null);
}
const prior=shadow.debugState();assert.throws(()=>shadow.setQuality({resolution:0}),/positive integer/);assert.equal(shadow.debugState().resolution,prior.resolution);assert.equal(shadow.visibility,graph);
shadow.dispose();console.log('PASS runtime shadow quality preserves graph and validates before mutation');
const bounded=createFireLightFieldShadow({renderer:{},scene:{},sourceNode:THREE.TSL.vec3(0),receiverNode:THREE.TSL.vec3(0,0,4),normalNode:THREE.TSL.vec3(0,0,-1),sourceSizeNode:THREE.TSL.float(.5),runtimeQuality:true});
assert.throws(()=>bounded.setQuality({blockerSamples:2**31}),/counter capacity/,'runtime sample counts cannot wrap their signed GPU loop counters');assert.equal(bounded.debugState().blockerSamples,9);bounded.dispose();
