// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as jax from '@jax-js/jax';
import {q4Fixture,q4Reference,q4FiniteDifference,denseWeights} from './q4-reference.mjs';
import {runQ4Case,runQ4Update} from './q4-checks.mjs';
import {compare} from './reference.mjs';
import {validateQ4Result} from './q4-validation.mjs';
import {createQ4LoraProjection} from './q4-lora.mjs';
import {q4Arrays} from './q4-checks.mjs';

test('scalar Q4/LoRA gradients match finite differences for every input and adapter value',()=>{
  const f=q4Fixture(),analytic=q4Reference(f),finite=q4FiniteDifference(f);
  for(const name of Object.keys(finite))compare(analytic.grad[name],finite[name],{atol:1e-9,rtol:1e-5});
});
test('uint32 nibble order and separate affine groups include high-bit words',()=>{
  const f=q4Fixture(),w=denseWeights(f);
  assert(f.base.packed.some(x=>x>=2**31));
  for(const i of [0,7,8,63,64,127,128,255]){
    const code=(i*7+Math.floor(i/8)*3)%16,g=Math.floor(i/64);
    assert.equal(w[i],code*f.base.scales[g]+f.base.biases[g]);
  }
});
test('jax packed projection contributes base input gradients and both LoRA gradients',async()=>{
  await jax.init('wasm');
  const result=await runQ4Case(jax,'wasm');
  assert.deepEqual(Object.keys(result.grad).sort(),['a','b','input']);
  const f=q4Fixture(),adapterOnly=structuredClone(f);adapterOnly.base.scales.fill(0);adapterOnly.base.biases.fill(0);
  assert.throws(()=>compare(q4Reference(adapterOnly).grad.input,q4Reference(f).grad.input),/numerical mismatch/);
});
test('one compiled SGD update changes both adapter factors and lowers the same loss',async()=>{
  await jax.init('wasm');
  const f=q4Fixture();
  const r=await runQ4Update(jax,'wasm',f,1,async(p,base)=>{
    assert(base?.packed,'consumer must receive the retained training base');
    compare(Array.from(await base.packed.ref.data()),f.base.packed,{atol:0,rtol:0});
    return 'retained training base';
  });
  assert(r.afterLoss<r.beforeLoss);
  assert.equal(r.handoff,'retained training base');
});
test('Q4 browser evidence rejects stale fixtures, missing base gradients and frozen updates',()=>{
  const f=q4Fixture(),r=q4Reference(f),next=structuredClone(f.params);
  for(const n of ['a','b'])next[n]=next[n].map((v,i)=>v-r.grad[n][i]);
  const nr=q4Reference(f,next),fixture={fixture:f,nativeOutput:r.output};
  const caseRecord={caseName:'q4-lora',dims:f.dims,backend:'webgpu',output:r.output,loss:r.loss,grad:r.grad};
  const update={caseName:'q4-lora-update',dims:f.dims,backend:'webgpu',learningRate:1,beforeLoss:r.loss,afterLoss:nr.loss,params:next,
    handoff:{output:nr.output,borrowedSurvived:true,sameDevice:true,frozenUnchanged:true}};
  const valid={nonce:'current',fixtureSha256:'fixture-digest',backend:{effective:'webgpu',vendor:'apple'},cases:[caseRecord,caseRecord,update]};
  const expected={nonce:'current',vendor:'apple',fixtureSha256:'fixture-digest',fixture};
  assert.equal(validateQ4Result(valid,expected),valid);
  for(const mutate of [x=>x.nonce='old',x=>x.fixtureSha256='old',x=>x.backend.effective='wasm',x=>delete x.cases[0].grad.input,
    x=>x.cases[2].params=structuredClone(f.params),x=>x.cases[2].handoff.output=[],x=>x.cases[2].afterLoss=x.cases[2].beforeLoss]){
    const wrong=structuredClone(valid);mutate(wrong);assert.throws(()=>validateQ4Result(wrong,expected));
  }
});
test('unsupported packed layout and malformed shapes reject before consumption',async()=>{
  assert.throws(()=>createQ4LoraProjection({...q4Fixture().dims,columns:65}),/layout/);
  await jax.init('wasm');jax.defaultDevice('wasm');
  const f=q4Fixture(),x=q4Arrays(jax,f);
  x.params.a=x.params.a.reshape([1,f.params.a.length]);
  assert.throws(()=>createQ4LoraProjection(f.dims)(x.params,x.base),/invalid a shape/);
  compare(Array.from(await x.params.input.ref.data()),f.params.input,{atol:0,rtol:0});
  jax.tree.dispose(x);
});

test('native fixture preparation preserves failure report on truncated observed arrays',async()=>{
  const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),crypto=await import('node:crypto'),cp=await import('node:child_process');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'q4-fixture-negative-')),bytes=Buffer.alloc(4),digest=crypto.createHash('sha256').update(bytes).digest('hex');
  const meta={affine:[{name:'a',group:64,columns:4096,rows:32,tokens:5}],arrays:{}};
  for(const n of ['weight','scales','biases','input','output'])meta.arrays['affine-a.'+n]={file:'partial.bin',bytes:4,sha256:digest,shape:[1],dtype:n==='weight'?'u32':'f32'};
  await fs.writeFile(path.join(root,'meta.json'),JSON.stringify(meta));await fs.writeFile(path.join(root,'partial.bin'),bytes);
  const out=path.join(root,'failed.json');
  const result=cp.spawnSync(process.execPath,['prepare-q4-fixture.mjs','--source',root,'--qwen-root',path.join(root,'absent'),'--qwen-commit','HEAD','--out',out],{cwd:new URL('.',import.meta.url),encoding:'utf8'});
  assert.equal(result.status,1);const r=JSON.parse(await fs.readFile(out));
  assert.equal(r.status,'failed');assert.match(r.error.message,/reference array layout weight/);
});
