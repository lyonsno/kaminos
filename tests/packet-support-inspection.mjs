// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePacketInspection} from '../particle-packet-support-view.mjs';
test('partial packet observations cannot masquerade as measured supports',()=>{
 assert.deepEqual(summarizePacketInspection({available:false,reason:'no observation'}),{available:false,reason:'no observation'});
 assert.throws(()=>summarizePacketInspection({available:true,receipt:{packetCapacity:2,kernelCapacity:4},packets:new Float32Array(16),kernels:new Float32Array(128),stats:new Uint32Array(16)}),/incomplete/i);
 const packets=new Float32Array(32);packets[3]=1;packets.set([2,3,6],8);const stats=new Uint32Array(16);stats.set([1,1,1,6,20,12,30,0,1]);
 const r=summarizePacketInspection({available:true,identity:{step:9},receipt:{packetCapacity:2,kernelCapacity:4},packets,kernels:new Float32Array(128),stats});assert.equal(r.counterOverflow,true);assert.equal(r.supportDiameter.max,7);assert.deepEqual(r.activeIds,[0]);assert.equal(r.identity.step,9);
});

test('support preview draws measured geometry in world coordinates and removes its own overlay',async()=>{
 const {Group}=await import('../lib/three.core.js');const {createPacketSupportView}=await import('../particle-packet-support-view.mjs');
 const parent=new Group(),view=createPacketSupportView(parent),packets=new Float32Array(16),kernels=new Float32Array(32);packets[3]=1;packets.set([2,3,6],8);
 const snapshot={available:true,packets,kernels,transform:{scale:2,translate:[10,20,30]}};
 view.set(snapshot,'packets');assert.equal(view.read().vertices,24);assert.deepEqual(view.read().bounds.center,[12,23,36]);assert.equal(view.read().bounds.radius,7);assert.equal(parent.children[0].material.depthWrite,false);
 kernels[4]=kernels[9]=kernels[14]=1;kernels[7]=3;new Uint32Array(kernels.buffer)[31]=1;
 view.set(snapshot,'emission');assert.equal(view.read().vertices,192);assert.ok(Math.abs(view.read().bounds.radius-6)<2e-6);assert.equal(parent.children[0].userData.kaminosEditorOnly,true);
 view.set(snapshot,'off');assert.equal(view.read().visible,false);view.dispose();assert.equal(parent.children.length,0);
});
