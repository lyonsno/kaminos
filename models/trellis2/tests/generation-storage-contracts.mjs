import assert from 'node:assert/strict';
import test from 'node:test';
import {validateGenerationInputs} from '../generation-inputs.js';
import {m} from './generation-input-fixture.js';
import {createHash} from 'node:crypto';
import {packGenerationTensor,expandGenerationTensor,readGenerationTensor,generationTensorStorage} from '../generation-storage.js';
const hash=raw=>createHash('sha256').update(new Uint8Array(raw)).digest('hex');

test('declared checkpoint storage is an authoritative decoding contract',()=>{
  const input=structuredClone(m),key=input.models.sparseFlow.tensors['block0.mlp.in.weight'];
  input.tensors[key].storage={encoding:'unknown-int4',file:'packed.bin',byteLength:8,sha256:'e'.repeat(64)};
  assert.throws(()=>validateGenerationInputs(input),/checkpoint storage/,
    'Ignoring an unknown storage encoding would silently fetch the legacy float32 route.');
});
test('lossless packing preserves every finite half value and every bfloat word',()=>{
  for(const encoding of ['f16-le','bf16-le']){
    const bits=Uint16Array.from({length:65536},(_,i)=>i),raw=expandGenerationTensor(bits.buffer,encoding);
    const packed=packGenerationTensor(raw);
    // NaN payloads are retained exactly in the bfloat route. The f16 decoder
    // canonicalizes NaNs; this test uses its exact logical float32 output.
    if(packed)assert.deepEqual(new Uint8Array(expandGenerationTensor(packed.bytes,packed.encoding)),new Uint8Array(raw));
    const finite=new Float32Array(raw).filter(Number.isFinite),p=packGenerationTensor(finite.buffer);
    assert.ok(p);assert.equal(p.bytes.byteLength,finite.byteLength/2);
    assert.equal(hash(expandGenerationTensor(p.bytes,p.encoding)),hash(finite.buffer));
  }
  assert.equal(packGenerationTensor(new Float32Array([Math.PI]).buffer),null,'full precision values must remain full precision');
});
test('loader verifies both physical and reconstructed identities with no legacy fallback',async()=>{
  const raw=new Float32Array([0,-0,1.001953125,-2,2**-24]).buffer,p=packGenerationTensor(raw);
  assert.equal(p.encoding,'f16-le');
  const row={file:'original.f32',dtype:'float32',shape:[5],byteLength:raw.byteLength,sha256:hash(raw),
    storage:{encoding:p.encoding,file:'compact.bin',byteLength:p.bytes.byteLength,sha256:hash(p.bytes)}};
  let calls=[];const fetchFile=async file=>{calls.push(file);return{ok:true,arrayBuffer:async()=>p.bytes};};
  const values=await readGenerationTensor(row,{fetchFile,hash});assert.equal(hash(values.buffer),hash(raw));
  assert.deepEqual(calls,['compact.bin']);
  await assert.rejects(readGenerationTensor({...row,sha256:'0'.repeat(64)},{fetchFile,hash}),/reconstructed/);
  await assert.rejects(readGenerationTensor({...row,storage:{...row.storage,sha256:'0'.repeat(64)}},{fetchFile,hash}),/changed checkpoint storage/);
  await assert.rejects(readGenerationTensor(row,{fetchFile:async()=>({ok:true,arrayBuffer:async()=>p.bytes.slice(0,2)}),hash}),/partial/);
  await assert.rejects(readGenerationTensor(row,{fetchFile:async()=>({ok:false}),hash}),/unavailable/);
  for(const storage of [null,{...row.storage,file:'../bad'},{...row.storage,byteLength:2},{...row.storage,encoding:'int8'}])
    assert.throws(()=>generationTensorStorage({...row,storage}),/checkpoint storage/);
});
