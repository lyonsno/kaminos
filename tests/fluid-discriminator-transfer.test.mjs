import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as transfer from '../tools/fluid-discriminator-evidence.mjs';

function fixture(){
  const words=Array.from({length:16},(_,i)=>1065353216+i);
  const sha256=createHash('sha256').update(Buffer.from(new Uint32Array(words).buffer)).digest('hex');
  const metadata={particleSnapshot:{particleCount:1,recordWords:16,stepCount:12},transfer:{encoding:'u32-le-json-chunks-v1',captureId:'held-12',wordCount:16,sha256}};
  return {words,metadata,chunks:[{captureId:'held-12',offset:0,words:words.slice(0,8)},{captureId:'held-12',offset:8,words:words.slice(8)}]};
}
test('full transfer reconstructs every captured word without changing snapshot metadata',()=>{
  assert.equal(typeof transfer.assembleDiscriminatorChunks,'function','Complete particle transfer must be validated before evidence admission');
  const {words,metadata,chunks}=fixture();
  const result=transfer.assembleDiscriminatorChunks(metadata,chunks);
  assert.deepEqual(result.words,words);assert.deepEqual(result.particleSnapshot,metadata.particleSnapshot);
});
test('partial, repeated, mixed-capture and corrupt transfers cannot become particle evidence',()=>{
  assert.equal(typeof transfer.assembleDiscriminatorChunks,'function','Complete particle transfer must be validated before evidence admission');
  const {metadata,chunks}=fixture();
  for(const bad of [[],chunks.slice(0,1),[chunks[0],chunks[0]],chunks.toReversed(),[chunks[0],{...chunks[1],captureId:'other'}],[chunks[0],{...chunks[1],words:chunks[1].words.map(x=>x+1)}],[chunks[0],{...chunks[1],words:chunks[1].words.concat(0)}]])assert.throws(()=>transfer.assembleDiscriminatorChunks(metadata,bad),/transfer/i);
  for(const fields of [{wordCount:8},{encoding:'sparse'},{sha256:'0'.repeat(64)}])assert.throws(()=>transfer.assembleDiscriminatorChunks({...metadata,transfer:{...metadata.transfer,...fields}},chunks),/transfer/i);
});
