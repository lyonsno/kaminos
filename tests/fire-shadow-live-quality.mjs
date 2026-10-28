// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFireLightFieldShadow} from '../fire-light-field-shadow.mjs';
const shadow=createFireLightFieldShadow({renderer:{backend:{device:{limits:{maxTextureDimension2D:8192}}}},scene:{},sourceNode:THREE.TSL.vec3(0),receiverNode:THREE.TSL.vec3(0,0,4),normalNode:THREE.TSL.vec3(0,0,-1),sourceSizeNode:THREE.TSL.float(.5),runtimeQuality:true,shadowSoftness:1,blockerSamples:2,filterSamples:2,resolution:128});
assert.equal(typeof shadow.setQuality,'function','quality edits need a live uniform/resource path');
const graph=shadow.visibility;
for(const q of [{resolution:64},{blockerSamples:3},{filterSamples:7},{resolution:128,blockerSamples:2,filterSamples:2}]){shadow.setQuality(q);assert.equal(shadow.visibility,graph,'quality must retain the same receiving shader graph');for(const [k,v] of Object.entries(q))assert.equal(shadow.debugState()[k],v);}
const prior=shadow.debugState();assert.throws(()=>shadow.setQuality({resolution:0}),/positive integer/);assert.equal(shadow.debugState().resolution,prior.resolution);assert.equal(shadow.visibility,graph);
shadow.dispose();console.log('PASS runtime shadow quality preserves graph and validates before mutation');
