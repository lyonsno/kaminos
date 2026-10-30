// kaminos-test: node
import assert from 'node:assert/strict';
import {independentImageProcessor} from '../models/bfl-pup/ordered-image-processor.mjs';
// Runtime contract: @huggingface/transformers@4.2.0,
// src/models/qwen2_vl/image_processing_qwen2_vl.js. Browser conformance also
// exercises its actual Qwen3VLProcessor on equal, unequal and reversed inputs.
const made=[],calls=[];
function tensor(rows){const t={rows,disposed:false,tolist:()=>rows,dispose(){this.disposed=true;}};made.push(t);return t;}
const single=Object.assign(async image=>{calls.push(image);return{
 pixel_values:tensor(Array.from({length:image.patches},()=>[image.value])),
 image_grid_thw:tensor([[1n,2n,BigInt(image.patches/2)]]),
 original_sizes:[[image.patches,2]],reshaped_input_sizes:[[image.patches,2]],
};},{config:{merge_size:2}});
const cat=(ts,axis)=>{assert.equal(axis,0);assert.ok(ts.every(t=>!t.disposed));return tensor(ts.flatMap(t=>t.rows.map(row=>[...row])));};
const prepare=independentImageProcessor(single,cat),a={patches:4,value:1},b={patches:8,value:-1};
assert.equal(prepare.config,single.config);
for(const images of [[a,b],[b,a]]){
 made.length=0;calls.length=0;const result=await prepare(images);
 assert.deepEqual(calls,images);assert.deepEqual(result.pixel_values.rows.flat(),images.flatMap(i=>Array(i.patches).fill(i.value)));
 assert.deepEqual(result.image_grid_thw.rows,images.map(i=>[1n,2n,BigInt(i.patches/2)]));
 assert.deepEqual(result.original_sizes,images.map(i=>[i.patches,2]));
 assert.ok(made.slice(0,4).every(t=>t.disposed));assert.equal(result.pixel_values.disposed,false);
}
made.length=0;const result=await prepare(a);assert.equal(result.pixel_values.disposed,false);assert.equal(made.length,2,'single image keeps native path');
made.length=0;await assert.rejects(independentImageProcessor(single,()=>{throw Error('concat failed');})([a,b]),/concat failed/);
assert.ok(made.every(t=>t.disposed),'failed concatenation releases prepared tensors');
console.log('Independent reference preparation preserves order, unequal grids, native single-image behavior and cleanup');
