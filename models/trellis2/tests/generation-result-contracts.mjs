import assert from 'node:assert/strict';
import {m} from './generation-input-contracts.mjs';
import {GENERATION_ROUTE,GENERATION_PHASES,GENERATION_FIELDS,generationModelCallCounts,validateGenerationResult} from '../sparse-generation-witness-checks.js';
const row=(shape,dtype='f32')=>({shape,dtype,byteLength:shape.reduce((n,x)=>n*x,4),sha256:'d'.repeat(64),finite:true}),
  c={dinoBlocksExecuted:24,lowResolutionRows:3,highResolutionRows:4,phases:[...GENERATION_PHASES],
    featureBytesToCPUDuringServing:0,coordinateBytesToCPUDuringServing:0,sameInvocation:true,stageCounts:{}},
  result={status:'succeeded',requestedRoute:GENERATION_ROUTE,effectiveRoute:GENERATION_ROUTE,
    backend:{vendor:'apple',description:'Apple M4 Max',isFallbackAdapter:false},numericalStatus:'not-compared',
    profileStatus:'passed',profile:{routeId:GENERATION_ROUTE,evidence:{mode:'live'}},composition:c,outputs:{}};
for(const [phase,count]of Object.entries(generationModelCallCounts(m)))c.stageCounts[phase]={'terminal-output-projection':count,'block-modulation':count*30};
for(const name of GENERATION_FIELDS)result.outputs[name]=row([3,8]);
Object.assign(result.outputs,{conditioning:row([1,1029,1024]),shapeCodes:row([4,32]),textureCodes:row([4,32]),
  'geometry.features':row([5,7]),'geometry.coordinates':row([5,3],'i32'),'material.features':row([5,6]),'material.coordinates':row([5,3],'i32'),
  'noise.sparse':row([1,8,16,16,16]),'noise.lowResolutionShape':row([3,32]),'noise.highResolutionShape':row([4,32]),'noise.texture':row([4,32])});
assert.equal(validateGenerationResult(result,m),true,'This is a synthetic reporting fixture, not a native model claim.');
const reject=(change,pattern)=>{const bad=structuredClone(result);change(bad);assert.throws(()=>validateGenerationResult(bad,m),pattern);};
reject(r=>r.effectiveRoute='fallback',/native generation/);
reject(r=>r.backend.isFallbackAdapter=true,/native Apple/);
reject(r=>r.profile.evidence.mode='cache',/native generation/);
reject(r=>r.numericalStatus='passed',/matched-reference/);
reject(r=>r.composition.phases.pop(),/complete resident/);
reject(r=>r.composition.stageCounts[GENERATION_PHASES[4]]['block-modulation']-=30,/complete actual30block/);
reject(r=>delete r.outputs['noise.texture'],/retained generation/);
reject(r=>r.outputs['geometry.features'].byteLength-=4,/retained generation/);
reject(r=>r.outputs['material.coordinates'].sha256='e'.repeat(64),/coordinate identity/);
reject(r=>r.outputs.conditioning.shape=[0],/retained generation/);
console.log('Generation evidence rejects fallback/cache, incomplete schedule/fields/noise, and invented matched-reference fidelity. These negative cases already reject; the synthetic reporting fixture does not establish an external backend contract.');
