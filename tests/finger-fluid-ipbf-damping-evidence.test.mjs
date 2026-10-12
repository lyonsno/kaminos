import test from 'node:test';
import assert from 'node:assert/strict';
import {createIPBFGridShader} from '../finger-fluid-ipbf-wgsl.mjs';
import {createWebGPUFingerFluidSolver} from '../finger-fluid-webgpu-core.js';
let api={};try{api=await import('../finger-fluid-ipbf-damping-evidence.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const snapshot=()=>({schema:'kaminos.ipbf-damping-step.v1',packing:'normal_alt_damped_context_vec4f_u32',stepCount:1,particleCount:1,recordWords:16,dampingEnabled:true,
  words:Array.from(new Uint32Array(new Float32Array([3,0,0,.08,1,0,0,.02,Math.sqrt(5),0,0,.5,1,.04,.001,10]).buffer))});
const particles=()=>({schema:'kaminos.finger-fluid-particle-words.v1',stepCount:1,particleCount:1,recordWords:16,
  words:Array.from(new Uint32Array(new Float32Array([0,0,0,1,0,0,0,1,Math.sqrt(5),0,0,.08,Math.sqrt(5),0,0,1]).buffer))});
const decode=(s=snapshot(),p=particles(),expected={stepCount:1,particleCount:1,radius:1,beta:.04,dampingEnabled:true})=>{
  assert.equal(typeof api.decodeIPBFDampingEvidence,'function','Missing replayable production damping evidence decoder');
  return api.decodeIPBFDampingEvidence(s,p,expected);
};
test('opt-in shader records normal, softer and damped velocities without changing default shader',()=>{
  const ordinary=createIPBFGridShader({radius:1,volume:.1});
  assert.doesNotMatch(ordinary,/dampingRecord/);
  const capture=createIPBFGridShader({radius:1,volume:.1,dampingDiagnostics:true});
  assert.match(capture,/dampingRecord:IPBFDampingRecord/,'Production damping records are missing');
  assert.equal((capture.match(/var<storage/g)??[]).length,(ordinary.match(/var<storage/g)??[]).length,'Capture must fit the existing storage-binding contract');
  assert.match(capture,/normal=vec4<f32>/);assert.match(capture,/alternate=vec4<f32>/);assert.match(capture,/damped=vec4<f32>/);
});
test('damping capture capability rejects invalid and non-IPBF requests before runtime launch',async()=>{
  await assert.rejects(createWebGPUFingerFluidSolver({ipbfDampingDiagnostics:'yes'}),/diagnostics.*boolean/i);
  await assert.rejects(createWebGPUFingerFluidSolver({ipbfDampingDiagnostics:true,pressureSolver:'pbf'}),/diagnostics.*IPBF/i);
});
test('captured velocities expose correction and its survival into committed velocity',()=>{
  const r=decode();assert.equal(r.records.length,1);
  assert.ok(Math.abs(r.records[0].removedEnergyFraction-4/9)<1e-6);
  assert.ok(r.records[0].committedDifference<1e-7);
  assert.equal(r.summary.applied,1);
});
test('stale, partial, nonfinite and substituted-radius/beta evidence cannot close',()=>{
  decode();
  for(const mutate of [s=>s.stepCount=0,s=>s.words.pop(),s=>s.words[0]=0x7f800000,s=>s.words[13]=new Uint32Array(new Float32Array([60]).buffer)[0],s=>s.words[12]=new Uint32Array(new Float32Array([.5]).buffer)[0]]){
    const s=snapshot();mutate(s);assert.throws(()=>decode(s));
  }
  const p=particles();p.stepCount=0;assert.throws(()=>decode(snapshot(),p),/identity/i);
});
test('zero applied weight and unchanged alternatives remain visible rather than false damping',()=>{
  const s=snapshot(),f=new Float32Array(new Uint32Array(s.words).buffer);
  f.set([3,0,0],4);f.set([3,0,0,0],8);s.words=Array.from(new Uint32Array(f.buffer));
  const p=particles(),v=new Float32Array(new Uint32Array(p.words).buffer);v.set([3,0,0],8);p.words=Array.from(new Uint32Array(v.buffer));
  const r=decode(s,p);assert.equal(r.summary.applied,0);assert.equal(r.records[0].removedEnergyFraction,0);
});

test('native storage readback maps once and preserves every strided diagnostic word',()=>{
  assert.equal(typeof api.readIPBFDampingRecordWords,'function','Missing single-map readback decoder');
  const source=Uint32Array.from({length:80},(_,i)=>i);let calls=0;
  const buffer={getMappedRange(){assert.equal(++calls,1,'Overlapping mapped range requested');return source.buffer;}};
  const result=api.readIPBFDampingRecordWords(buffer,2);
  assert.deepEqual(result,[...source.slice(24,40),...source.slice(64,80)]);assert.equal(calls,1);
  assert.throws(()=>api.readIPBFDampingRecordWords({getMappedRange:()=>source.buffer},3),/complete|length/i);
});
