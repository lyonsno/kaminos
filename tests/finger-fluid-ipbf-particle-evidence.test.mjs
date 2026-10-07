import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';
const identity={stepCount:120,pressureSolver:'ipbf',boundaryPressureContract:'ipbf-cubic-tangent-plane-density-v1'};
test('raw particle evidence preserves every f32 bit and the effective pressure identity',()=>{
 assert.equal(typeof core.captureFingerFluidParticleWordsForWitness,'function','full particle diagnostic capture is missing');
 const input=new Float32Array(32);input[0]=.1;input[15]=Infinity;input[31]=NaN;
 const snapshot=core.captureFingerFluidParticleWordsForWitness(input,2,identity);
 assert.equal(snapshot.particleCount,2);assert.equal(snapshot.stepCount,120);assert.equal(snapshot.recordWords,16);
 assert.deepEqual(snapshot.words,Array.from(new Uint32Array(input.buffer)));
 assert.equal(snapshot.boundaryPressureContract,identity.boundaryPressureContract);
 assert.equal(snapshot.pressureSolver,'ipbf');
});
test('partial, stale or substituted raw particle evidence fails visibly',()=>{
 const input=new Float32Array(32);
 assert.throws(()=>core.captureFingerFluidParticleWordsForWitness(input,3,identity),/particle.*shape/);
 assert.throws(()=>core.captureFingerFluidParticleWordsForWitness(input,2,{...identity,stepCount:-1}),/step/);
 assert.throws(()=>core.captureFingerFluidParticleWordsForWitness(input,2,{...identity,pressureSolver:'pbf'}),/boundary/);
 assert.throws(()=>core.captureFingerFluidParticleWordsForWitness(input,2,{...identity,boundaryPressureContract:'unknown'}),/boundary/);
});

test('pending or stopped diagnostics cannot silently complete a full capture',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
 const start=source.indexOf('  async function requestDiagnostics('),open=source.indexOf('{\n',start);assert.ok(start>=0&&open>=0);
 let depth=1,end=open+1;for(;depth&&end<source.length;){end++;if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
 const actual=source.slice(start,end+1).trim();
 const construct=new Function('diagnosticsPending','diagnostics','runtimeLifecycle',`return (${actual});`);
 const cached={stepCount:119,particleSnapshot:null};
 const pending=construct(true,cached,{stopped:false}),stopped=construct(false,cached,{stopped:true});
 await assert.rejects(pending({captureParticleState:true}),/pending|busy/);
 await assert.rejects(stopped({captureParticleState:true}),/stopped/);
 assert.equal(await pending(),cached,'ordinary diagnostics retain cached behavior');
});
