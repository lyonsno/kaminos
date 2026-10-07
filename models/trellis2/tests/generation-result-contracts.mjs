import assert from 'node:assert/strict';
import test from 'node:test';
import {m} from './generation-input-fixture.js';
import {GENERATION_ROUTE,GENERATION_PHASES,GENERATION_FIELDS,generationModelCallCounts,generationPhases,validateGenerationResult} from '../sparse-generation-witness-checks.js';
const row=(shape,dtype='f32')=>({shape,dtype,byteLength:shape.reduce((n,x)=>n*x,4),sha256:'d'.repeat(64),finite:true}),
  c={dinoBlocksExecuted:24,lowResolutionRows:3,highResolutionRows:4,phases:[...GENERATION_PHASES],
    featureBytesToCPUDuringServing:0,coordinateBytesToCPUDuringServing:0,sameInvocation:true,stageCounts:{},
    geometryResolution:1024,materialResolution:1024,
    geometryLevels:[4,6,7,8,5].map((rows,i)=>({rows,resolution:64*2**i,channels:[1024,512,256,128,64][i],blocksExecuted:[4,16,8,4,0][i]}))},
  result={status:'succeeded',requestedRoute:GENERATION_ROUTE,effectiveRoute:GENERATION_ROUTE,
    backend:{vendor:'apple',description:'Apple M4 Max',isFallbackAdapter:false},numericalStatus:'not-compared',
    profileStatus:'passed',profile:{routeId:GENERATION_ROUTE,evidence:{mode:'live'}},composition:c,outputs:{}};
for(const [phase,count]of Object.entries(generationModelCallCounts(m)))c.stageCounts[phase]={'terminal-output-projection':count,'block-modulation':count*30};
for(const name of GENERATION_FIELDS)result.outputs[name]=row([3,8]);
c.materialLevels=structuredClone(c.geometryLevels);
for(let i=0;i<4;i++)result.outputs['geometry.subdivision'+i]=row([c.geometryLevels[i].rows,8]);
Object.assign(result.outputs,{conditioning:row([1,1029,1024]),shapeCodes:row([4,32]),textureCodes:row([4,32]),
  'geometry.features':row([5,7]),'geometry.coordinates':row([5,3],'i32'),'material.features':row([5,6]),'material.coordinates':row([5,3],'i32'),
  'noise.sparse':row([1,8,16,16,16]),'noise.lowResolutionShape':row([3,32]),'noise.highResolutionShape':row([4,32]),'noise.texture':row([4,32])});
assert.equal(validateGenerationResult(result,m),true,'This is a synthetic reporting fixture, not a native model claim.');
const preview=structuredClone(m),previewResult=structuredClone(result);
preview.pipelineType='512';preview.meshResolution=512;preview.samplingSteps=8;delete preview.models.highResolutionShape;
for(const role of ['sparseFlow','lowResolutionShape','textureFlow'])preview.models[role].config.steps=8;
for(const role of ['shapeDecoder','textureDecoder'])preview.models[role].config.resolution=32;
const pc=previewResult.composition;pc.pipelineType='512';pc.highResolutionRows=pc.lowResolutionRows;
pc.phases=[...generationPhases(preview)];pc.geometryResolution=512;pc.materialResolution=512;pc.stageCounts={};
pc.geometryLevels[0].rows=3;for(const level of pc.geometryLevels)level.resolution/=2;
pc.materialLevels=structuredClone(pc.geometryLevels);
for(const [phase,count]of Object.entries(generationModelCallCounts(preview)))pc.stageCounts[phase]={'terminal-output-projection':count,'block-modulation':count*30};
previewResult.outputs.shapeCodes=row([3,32]);previewResult.outputs.textureCodes=row([3,32]);previewResult.outputs['noise.texture']=row([3,32]);
previewResult.outputs['geometry.subdivision0']=row([3,8]);delete previewResult.outputs['noise.highResolutionShape'];
assert.equal(validateGenerationResult(previewResult,preview),true,'Synthetic source512 reporting contract, not a native preview witness.');
for(const mutate of [r=>r.composition.pipelineType='1024_cascade',r=>r.composition.phases.push('learned-cascade-support'),
  r=>r.composition.highResolutionRows=4,r=>r.composition.stageCounts['high-resolution-shape-sampling']={}]){
  const bad=structuredClone(previewResult);mutate(bad);assert.throws(()=>validateGenerationResult(bad,preview));
}
let negativeCase=0;
const reject=(change,pattern)=>test('reject reporting case '+(++negativeCase),()=>{
  const bad=structuredClone(result);change(bad);assert.throws(()=>validateGenerationResult(bad,m),pattern);});
for(const name of ['geometry.features','material.features','geometry.subdivision0'])reject(r=>r.outputs[name].dtype='i32',/F32|f32/);
reject(r=>r.composition.geometryResolution=512,/resolution/);
reject(r=>r.composition.materialResolution=512,/resolution/);
reject(r=>delete r.composition.geometryLevels,/decoder level/);
reject(r=>r.composition.geometryLevels[1].blocksExecuted=0,/decoder level/);
reject(r=>r.composition.materialLevels[2].rows=6,/decoder level/);
reject(r=>r.outputs['geometry.subdivision0']=row([3,8]),/subdivision/);
reject(r=>r.outputs['geometry.subdivision1']=row([6,4]),/subdivision/);
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
