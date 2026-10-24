// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFlux3AuthoringResult as validate,waitForAuthoringGpuHost} from '../models/flux3-klein/run-authoring-smoke.mjs';
const good=()=>({runtime:{flux3:{mounted:true,modelRoot:'/local/pack'}},expectedModelRoot:'/local/pack',
 manifest:{source:{repo:'base',revision:'rev'},sampling:{shift:3,steps:4},lora:{sha256:'adapter'}},
 provenance:{route:'flux3-klein.text-to-image.authoring-shared-device.v0',model:'FLUX.3 Image Klein',weights:'/flux3-weights',transformer:'/flux3-weights/dit',width:512,height:512,source:{repo:'base',revision:'rev'},sampling:{shift:3,steps:4},lora:{sha256:'adapter'}},
 load:{startedAt:1,finishedAt:90,stats:{cacheWeights:false,cachedBytes:0,downloadedBytes:100},cacheWrites:[]},
 expectedSize:512,output:{width:512,height:512,bytes:3000,distinctRgb:100},frames:{before:1,after:20,inference:{before:5,after:15,startedAt:100,finishedAt:200},compute:[{before:7,after:10,startedAt:125,finishedAt:175} ]},gpuErrors:[]});
test('the smoke admits a retained FLUX.3 image from the requested local route',()=>{assert.doesNotThrow(()=>validate(good()));});
test('fallback model, wrong mount and substituted sampling cannot pass as FLUX.3 evidence',()=>{
 for(const mutate of [r=>r.provenance.model='FLUX.2 [klein] 4B',r=>r.provenance.route='flux2-klein.text-to-image.authoring-shared-device.v0',r=>r.runtime.flux3.mounted=false,r=>r.runtime.flux3.modelRoot='/wrong',r=>r.provenance.sampling.steps=16,r=>r.provenance.source.revision='wrong',r=>r.gpuErrors.push('validation error')]){
  const r=good();mutate(r);assert.throws(()=>validate(r));
 }
});
test('blank, missing, partial output and absent foreground progression cannot pass',()=>{
 for(const mutate of [r=>r.output=null,r=>r.output.distinctRgb=1,r=>r.output.bytes=0,r=>r.output.width=256,r=>r.frames.inference.after=r.frames.inference.before,r=>delete r.provenance]){
  const r=good();mutate(r);assert.throws(()=>validate(r));
 }
});
test('controls can exist before the shared GPU host; the smoke waits for the actual host',async()=>{
 let reads=0,waits=0;const host={features:['shader-f16']};
 const actual=await waitForAuthoringGpuHost({read:async()=>++reads<3?null:host,wait:async()=>{waits++;}});
 assert.equal(actual,host);assert.equal(waits,2);
});

test('frames before or after inference cannot certify rendering during computation',()=>{
 for(const inference of [undefined,{before:10,after:10,startedAt:100,finishedAt:200},{before:10,after:11,startedAt:200,finishedAt:100}]){
  const r=good();r.frames={before:1,after:20,inference};assert.throws(()=>validate(r));
 }
});

test('embedding retrieval frames cannot certify foreground progress during denoising',()=>{
 const r=good();r.frames.inference={before:10,after:11,startedAt:100,finishedAt:200};
 r.frames.compute=[{before:11,after:11,startedAt:125,finishedAt:175}];assert.throws(()=>validate(r));
});

test('cold-load evidence rejects missing timing, cache fallback, and actual cache writes',()=>{
 for(const mutate of [r=>delete r.load,r=>r.load.finishedAt=r.load.startedAt,r=>r.load.stats.cacheWeights=true,r=>r.load.stats.cachedBytes=1,r=>r.load.cacheWrites.push({url:'/flux3-weights/te/weight.bin'}),r=>delete r.load.stats]){
  const r=good();mutate(r);assert.throws(()=>validate(r));
 }
});

test('an inspection request cannot pass without real visible previews and exercised display controls',()=>{
 const r=good();r.inspectControls=true;
 assert.throws(()=>validate(r),/inspection|preview/i,'a normal final image alone cannot close the new UI witness');
});

const inspected=()=>{const r=good();r.inspectControls=true;r.entry={source:'/original.png'};r.provenance.elapsed={generationMs:1250,loadMs:89};r.inspection={previews:[{step:1,at:150,visible:true,distinctRgb:20,timer:'Generating 0.5 s'}],compactHeight:144,expandedHeight:320,expandedPressed:true,originalSource:'/original.png',preparedSource:'/cutout.png',segmentedSource:'/cutout.png',preferenceAfterGeneration:false,preferenceAfterReload:false,timerAfter:'Generated in 1.3 s'};return r;};
test('inspection evidence rejects blank/hidden/stale previews, inert expansion, wrong cutout and missing retained time',()=>{
 assert.doesNotThrow(()=>validate(inspected()));
 for(const mutate of [r=>r.inspection.previews=[],r=>r.inspection.previews[0].distinctRgb=1,r=>r.inspection.previews[0].visible=false,r=>r.inspection.previews[0].at=99,r=>r.inspection.expandedHeight=144,r=>r.inspection.segmentedSource='/original.png',r=>r.inspection.preferenceAfterGeneration=true,r=>r.inspection.preferenceAfterReload=true,r=>r.inspection.previews[0].timer='',r=>r.inspection.timerAfter='',r=>delete r.provenance.elapsed]){const r=inspected();mutate(r);assert.throws(()=>validate(r));}
});
test('early-decode evidence rejects an unchanged full schedule or a frozen flame',()=>{
 const r=good();r.decodeAfter=1;
 assert.throws(()=>validate(r),/completion|decode/i);
 r.provenance.completion={stepsRequested:4,stepsCompleted:1,earlyDecoded:true};
 r.flame={before:3,after:6,stopped:true,backend:'WebGPU:apple',simGrid:32,raySteps:4,width:100,height:100};
 assert.doesNotThrow(()=>validate(r));
 for(const mutate of [r=>r.provenance.completion.earlyDecoded=false,r=>r.provenance.completion.stepsCompleted=4,r=>r.flame.after=r.flame.before,r=>r.flame.stopped=false,r=>r.flame.simGrid=128]){const bad=structuredClone(r);mutate(bad);assert.throws(()=>validate(bad));}
});
