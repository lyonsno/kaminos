// kaminos-test: node
import assert from 'node:assert/strict';
import {createHandReachState} from '../models/mobrecon/hand-reach-state.js';
const target={position:[0,0,0],radius:.02};
const state=createHandReachState({target,cube:{position:[.1,0,0],size:.05}});
function pose(index,thumb) { const a=new Float32Array(63); a.set(index,24);a.set(thumb,12);return a; }
let r=state.update({valid:true,joints:pose([0,0,.01],[.05,0,.01])});
assert.equal(r.contact,true);
r=state.update({valid:true,joints:pose([0,0,.1],[.05,0,.1])});
assert.equal(r.contact,false,'overlapping screen XY is not 3D contact');
state.update({valid:true,joints:pose([.09,0,0],[.15,0,0])});
r=state.update({valid:true,joints:pose([.09,0,0],[.11,0,0])});
assert.equal(r.grabbed,true);
const offset=r.cubePosition.map((v,i)=>v-r.pinchPoint[i]);
r=state.update({valid:true,joints:pose([.09,.1,-.1],[.11,.1,-.1])});
r.cubePosition.forEach((v,i)=>assert.ok(Math.abs(v-r.pinchPoint[i]-offset[i])<1e-6));
const held=r.cubePosition;
r=state.update({valid:true,joints:pose([.09,.1,-.1],[.16,.1,-.1])});
assert.equal(r.grabbed,false);
assert.deepEqual(r.cubePosition,held,'release does not teleport to a target');
state.setCube({position:[.1,0,0],size:.05});
state.update({valid:true,joints:pose([.09,0,0],[.11,0,0])});
r=state.lose();
assert.equal(r.tracking,false);assert.equal(r.grabbed,false);assert.equal(r.contact,false);
assert.equal(state.update({valid:true,joints:pose([.09,0,0],[.11,0,0])}).grabbed,false,
  'reacquisition while already pinching must not grab silently');
state.update({valid:true,joints:pose([.09,0,0],[.16,0,0])});
assert.equal(state.update({valid:true,joints:pose([.09,0,0],[.11,0,0])}).grabbed,true);
assert.equal(state.update({valid:true,joints:pose([NaN,0,0],[.11,0,0])}).tracking,false);
assert.throws(()=>state.setTarget({position:[0,0,NaN],radius:.02}),/target/);
assert.throws(()=>state.setCube({position:[0,0,0],size:0}),/cube/);
assert.equal(state.reset().tracking,false);
console.log('hand reach: depth contact, offset grab, release and loss contracts pass');
