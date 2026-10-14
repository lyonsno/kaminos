// kaminos-test: node
import assert from 'node:assert/strict';
import {createAuthoredWaterDrop} from '../authored-water-drop.mjs';
import {fingerFluidReferenceBoxSupport,validateFingerFluidReferenceBox} from '../finger-fluid-discriminator.mjs';
const pose={position:[0,.5,0],rotation:[0,0,0],scale:[1,1,1]};
const {box}=createAuthoredWaterDrop({width:.5,samplesPerUnit:32,container:null},pose);
assert.equal(box.collisions,false);
const shader=fingerFluidReferenceBoxSupport(box);
assert.match(shader,/fn resolveSupportPenetration\(p:vec3<f32>,r:f32\)->vec3<f32>\s*\{\s*_=r;\s*return p;/,'disabling the container must remove its collision projection, including the implicit floor');
assert.throws(()=>validateFingerFluidReferenceBox({...box,collisions:'off'}),/collision/i);
console.log('Explicit container-off support removes implicit terrain and floor');
