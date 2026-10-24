// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {KleinTransformer} from '../models/flux2-klein/klein-transformer.js';
import {KleinPipeline} from '../models/flux2-klein/klein-pipeline.js';
import {referenceImageGeometry} from '../models/flux3-klein/reference-image.js';

test('FLUX2 reference tokens participate in attention while velocity and Euler state contain generated tokens only',()=>{
 const mock={D:128,F:256,H:1,cfg:{joint_attention_dim:64},release(){},buffer:size=>({size})};
 KleinTransformer.prototype.allocate.call(mock,4,2,3);
 assert.equal(mock.shape.L,9);assert.equal(mock.shape.refTokens,3);
 assert.equal(mock.act.reference.size,3*128*4);
 assert.equal(mock.act.latents.size,4*128*4);assert.equal(mock.act.velocity.size,4*128*4);
 const writes=[];mock.device={queue:{writeBuffer:(buffer,offset,data)=>writes.push({buffer,offset,data:[...data]})}};
 const input={latents:new Float32Array(4*128),promptEmbeds:null,imgIds:new Float32Array(4*4),txtIds:new Float32Array(2*4),reference:new Float32Array(3*128).fill(.75),referenceIds:new Float32Array(3*4)};
 KleinTransformer.prototype.prepare.call(mock,input);
 assert.equal(writes.find(x=>x.buffer===mock.act.reference).data.length,384);
 assert.throws(()=>KleinTransformer.prototype.prepare.call(mock,{...input,reference:new Float32Array(128)}),/Reference.*shape/);
});

test('FLUX2 reference coordinates are T=10, unscaled row/column, L=0 (pinned diffusers contract)',()=>{
 assert.equal(typeof KleinPipeline.prototype.referenceIds,'function');
 assert.deepEqual([...KleinPipeline.prototype.referenceIds.call({},2,2)],[10,0,0,0,10,0,1,0,10,1,0,0,10,1,1,0]);
});

test('FLUX2 preprocessing preserves aspect and applies its canonical one-megapixel reference area',()=>{
 const g=referenceImageGeometry(2048,1024,{maxArea:1024*1024});
 assert.equal(g.resizedWidth,1448);assert.equal(g.resizedHeight,724);
 assert.equal(g.width,1440);assert.equal(g.height,720);
 assert.equal(referenceImageGeometry(259,145,{maxArea:1024*1024}).width,256);
});
