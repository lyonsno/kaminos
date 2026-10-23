// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFlux3AuthoringResult as validate,waitForAuthoringGpuHost} from '../models/flux3-klein/run-authoring-smoke.mjs';
const good=()=>({runtime:{flux3:{mounted:true,modelRoot:'/local/pack'}},expectedModelRoot:'/local/pack',
 manifest:{source:{repo:'base',revision:'rev'},sampling:{shift:3,steps:4},lora:{sha256:'adapter'}},
 provenance:{route:'flux3-klein.text-to-image.authoring-shared-device.v0',model:'FLUX.3 Image Klein',weights:'/flux3-weights',transformer:'/flux3-weights/dit',width:512,height:512,source:{repo:'base',revision:'rev'},sampling:{shift:3,steps:4},lora:{sha256:'adapter'}},
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
