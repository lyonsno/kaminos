// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
import {MLS_PRESENTATION_OPTICS_WGSL} from '../mls-juice-renderer.mjs';
test('production water optics preserve physical thickness across presentation scales',async()=>{
 await withKaminosGpu(async ctx=>{
  const options={preamble:MLS_PRESENTATION_OPTICS_WGSL,argTypes:['f32','f32'],returnType:'vec2<f32>',body:'return vec2f(mlsPhysicalThickness(arg0,arg1),mlsOcclusionAllowance(arg1));',inputs:[[.2,1],[.01,.05],[.04,.2]]};
  const actual=await evalWgslBatch(ctx,options);for(let i=0;i<actual.length;i++){assert.ok(Math.abs(actual[i][0]-.2)<1e-6);assert.ok(Math.abs(actual[i][1]-.005*options.inputs[i][1])<1e-7);}
  const fault=await evalWgslBatch(ctx,{...options,preamble:MLS_PRESENTATION_OPTICS_WGSL.replace('rendered / presentationScale','rendered')});
  assert.ok(Math.abs(fault[1][0]-.2)>.1,'the oracle rejects the original unscaled optical path');
 });
});
