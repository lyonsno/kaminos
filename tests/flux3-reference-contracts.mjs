// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {Flux3Transformer,flux3ImageIds} from '../models/flux3-klein/flux3-transformer.js';
test('reference image positions preserve the grid and use the canonical negative image coordinate',()=>{
 assert.deepEqual([...flux3ImageIds(2,2,-1)],[0,0,0,-1,0,0,.5,-1,0,.5,0,-1,0,.5,.5,-1]);
});
test('reference tokens extend the joint sequence but not the generated velocity output',()=>{
 const mock={D:128,F:256,H:1,cfg:{joint_attention_dim:64},release(){},buffer:bytes=>({size:bytes})};
 Flux3Transformer.prototype.allocate.call(mock,4,2,3);
 assert.equal(mock.shape.L,9);assert.equal(mock.shape.refTokens,3);assert.equal(mock.act.reference.size,3*128*4);assert.equal(mock.act.velocity.size,4*128*4);
 assert.equal(mock.modOff.earlyRef,14*128);assert.equal(mock.modOff.singleRef,17*128);
});
import {KleinVaeDecoder} from '../models/flux2-klein/klein-vae.js';
test('encoder downsampling halves each axis with right/bottom padding',async()=>{
 const uniforms=[];const mock={actType:'f16',convVersion:2,t:()=>({shape:[128,128*9],offset:0}),pipeline(){},dispatch(){},uniform:x=>{uniforms.push(x);return x;},sched:{budget:()=>Infinity,addFlops(){}}};
 const shape=await KleinVaeDecoder.prototype.conv.call(mock,{},null,null,'down',{Hin:32,Win:48,Cin:128,down:true});
 assert.deepEqual(shape,{H:16,W:24,C:128});assert.equal(uniforms[0][11],2);
});
