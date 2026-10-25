// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { visionPositions, penalizeGenerated, helperMessages } from '../models/bfl-pup/browser-backend.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/bfl-pup/vision-positions.json',import.meta.url)));
for(const c of fixture.cases){
 const r=visionPositions(c.grid);
 assert.deepEqual(Array.from(r.positionIds,Number),c.position_ids.flat());
 assert.deepEqual(Array.from(r.interpIndices,Number),c.interp_indices.flat());
 c.interp_weights.flat().forEach((v,i)=>assert.ok(Math.abs(r.interpWeights[i]-v)<1e-6));
}
assert.throws(()=>visionPositions([2,4,4]),/one image/);
assert.throws(()=>visionPositions([1,3,4]),/merge/);
const logits=new Float32Array([4,4,4,4,4]);
penalizeGenerated([1n,2n,3n,3n],2,logits,1.5);
assert.deepEqual([...logits],[4,4,4,2.5,4],'penalize each generated token once; prompt-only ids stay untouched');
assert.deepEqual(helperMessages('blue',2,{t2i:'scene',i2i:'edit'}),[
 {role:'system',content:'edit'},
 {role:'user',content:[{type:'image'},{type:'image'},{type:'text',text:'Reference images follow in order (the first image, the second image, ...).\nUser request: blue\nOutput the caption.'}]}]);
assert.equal(helperMessages('train',0,{t2i:'scene',i2i:'edit'})[1].content,'train');
assert.throws(()=>helperMessages('x',11,{}),/10/);
console.log('BFL browser input contracts pass');
const {validateExpansion}=await import('../models/bfl-pup/witness-contract.mjs');
const good={backend:'transformers.js/onnx-webgpu',modelRevision:'3f3edb52b2c55de0d49feab28598b68f7f8e4830',text:'blue kettle',partial:false,stopReason:'eos',referenceCount:1,sessions:{embed_tokens:{device:'webgpu'},vision_encoder:{device:'webgpu'},decoder_model_merged:{device:'webgpu'}}};
assert.doesNotThrow(()=>validateExpansion(good,1));
for(const change of [{backend:'mlx-metal'},{modelRevision:'base-qwen'},{text:' '},{partial:true},{stopReason:'output-limit'},{referenceCount:0},{sessions:{}},{sessions:{...good.sessions,decoder_model_merged:{device:'wasm'}}}])assert.throws(()=>validateExpansion({...good,...change},1));
const {referenceSize}=await import('../models/bfl-pup/reference-policy.mjs');
const sizes=JSON.parse(fs.readFileSync(new URL('./fixtures/bfl-pup/reference-sizes.json',import.meta.url)));
for(const c of sizes.cases)assert.deepEqual(referenceSize(c.width,c.height,c.references),c.size);
assert.throws(()=>referenceSize(2010,10,1),/200/);
