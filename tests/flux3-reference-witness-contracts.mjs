// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {compareReferenceValues as compare,validateReferenceWitness as validate} from '../models/flux3-klein/reference-witness.js';
const good=()=>({phase:'done',gpuErrors:[],adapter:{vendor:'apple',fallback:false},weights:{format:'i4',globals_format:'i8',group:64,mode:'text-and-image',source:{revision:'r'},lora:{sha256:'l'}},oracle:{weights:{format:'i4',globals_format:'i8',group:64},sourceRevision:'r',loraSha256:'l',referenceEffectL2:.2},checks:Object.fromEntries(['encoder-f32','encoder-f16','transformer'].map(k=>[k,{pass:true}]))});
test('missing, blank, nonfinite or numerically wrong tensors cannot pass parity',()=>{
 for(const [a,b] of [[[],[]],[[1],[1,2]],[[NaN],[1]],[[1],[0]]])assert.throws(()=>compare(a,b,.001));
 assert.equal(compare([1,2],[1,2],.001).pass,true);assert.equal(compare([1,4],[1,2],.001).pass,false);
});
test('a fallback or partial witness cannot close reference conditioning',()=>{
 assert.doesNotThrow(()=>validate(good()));
 for(const change of [r=>r.phase='encoder-f32',r=>r.adapter.fallback=true,r=>r.gpuErrors=['bad shader'],r=>r.weights.mode='text-to-image',r=>r.weights.source.revision='other',r=>r.weights.lora.sha256='other',r=>delete r.checks.transformer,r=>r.checks['encoder-f16'].pass=false,r=>r.oracle.referenceEffectL2=0]){const r=good();change(r);assert.throws(()=>validate(r));}
});

test('different quantization cannot masquerade as the CPU oracle weight route',()=>{
 const r=good();r.weights.format='i3';r.weights.globals_format='i8';r.weights.group=64;r.oracle.weights={format:'i4',globals_format:'i8',group:64};
 assert.throws(()=>validate(r),/quantization/);
});

test('FLUX2 reference witness refuses a different model oracle',()=>{
 const r=good();r.model='flux2';r.oracle.model='flux3';
 assert.throws(()=>validate(r),/model/);
});

test('separate global groups must match, while omitted groups inherit the block group',()=>{
 const r=good();r.model=r.oracle.model='flux2';r.weights.source.repo='black-forest-labs/FLUX.2-klein-4B';
 r.weights.globals_format=r.oracle.weights.globals_format='i4';
 r.weights.group=r.oracle.weights.group=128;
 r.weights.globals_group=64;r.oracle.weights.globals_group=128;
 assert.throws(()=>validate(r),/quantization/);
 delete r.oracle.weights.globals_group;
 assert.throws(()=>validate(r),/quantization/);
 r.oracle.weights.globals_group=64;assert.doesNotThrow(()=>validate(r));
 delete r.weights.globals_group;assert.throws(()=>validate(r),/quantization/);
 r.oracle.weights.globals_group=128;assert.doesNotThrow(()=>validate(r));
});
