// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as evidence from '../tools/stone-chunk-chain-evidence.mjs';

test('supported-stone evidence rejects a soft, substituted, stale or partial body',()=>{
 assert.equal(typeof evidence.requireSupportedStoneResponse,'function','Supported Stone needs current complete native profile and sag admission');
 const model={points:2,elements:1,bonds:1},configuration={gravity:9.81,iterations:12,timeStep:1/60},state=Array(32).fill(0);state[3]=state[19]=1;state[11]=1;state[16]=state[20]=1;state[21]=-.001;
 const expected={name:'bounded-stiff-brittle-elastic-support-v2',young:10000000,density:1000,threshold:18000,gripStiffness:20000000,model,configuration,minimumSteps:60,maximumDropFraction:.0143},sample={status:{route:'kaminos.picked-stone.bounded-shards.webgpu.v0',backend:'webgpu',adapterFallback:false,connectivity:'elastic-support',runId:'r',submittedSteps:60,paused:true,model},state:{runId:'r',steps:60,model,observation:{kind:'full-diagnostic'},energyKernel:'isotropic-degradation-v1',state,bonds:[0,1,1,0]},configuration:{...configuration,gripStiffness:20000000},materialRegime:{name:expected.name,material:{young:10000000,density:1000},threshold:18000}};
 sample.status.threshold=18000;
 assert.equal(evidence.requireSupportedStoneResponse(sample,expected).dropFraction,.001);
 for(const mutate of [s=>s.status.adapterFallback=true,s=>s.materialRegime.material.young=100000,s=>s.configuration.gravity=0,s=>s.state.steps=59,s=>s.state.state.splice(16),s=>s.state.state[21]=-.2,s=>s.state.bonds[2]=0,s=>s.state.state[4]=.01,s=>s.state.observation.kind='submitted',s=>s.state.energyKernel='fallback']){const value=structuredClone(sample);mutate(value);assert.throws(()=>evidence.requireSupportedStoneResponse(value,expected));}
 assert.throws(()=>evidence.requireSupportedStoneResponse(sample,{...expected,model:{...model,points:1}}));
});
