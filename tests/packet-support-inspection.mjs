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
