import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evalWgslBatch,withKaminosGpu} from '../../tools/shader-herder.mjs';
const source=readFileSync(new URL('../../volume-core.js',import.meta.url),'utf8');
const start=source.indexOf('  var expensiveSampleBudget ='),end=source.indexOf('\n',source.indexOf('  let maxTraversalSteps =',start));
const preamble=`struct Header {sampleCount:u32};struct Split {size:vec4<u32>};fn worldMinimumMaterialPitch()->f32{return .1;}fn worldMarchStep(p:f32,s:f32)->f32{return p;}`;
const body=`let steps=arg0;let opticalTrace=(arg1&1u)!=0u;let SPLIT_INTEGRAL=(arg1&2u)!=0u;let opticalTraceHeader=Header(u32(arg2));let splitOptions=Split(vec4<u32>(0u,0u,u32(arg3),0u));let GRID_Y=12u;let worldActive=false;let startT=0.0;let endT=2.0;${source.slice(start,end)}return vec2<f32>(f32(expensiveSampleBudget),f32(maxTraversalSteps));`;
const faultBody=body.replace('if(SPLIT_INTEGRAL)','if(false)');
const modules=[body,faultBody].map((b,i)=>({label:'production optical budget '+i,entryPoint:'main',code:preamble+'\nfn evaluate(arg0:f32,arg1:u32,arg2:f32,arg3:f32)->vec2<f32>{'+b+'}\n@compute @workgroup_size(1) fn main(){_=evaluate(8.0,3u,16.0,32.0);}'}));
export const assertOpticalBudget=()=>withKaminosGpu(async ctx=>{
 const options={preamble,argTypes:['f32','u32','f32','f32'],returnType:'vec2<f32>',body,inputs:[[8,0,16,32],[8,1,16,32],[8,2,16,32],[8,3,16,32]]};
 const expected=[[8,47],[16,55],[32,71],[32,71]];
 assert.deepEqual(await evalWgslBatch(ctx,options),expected);
 assert.notDeepEqual(await evalWgslBatch(ctx,{...options,body:faultBody}),expected,'a lost split budget override must fail the numerical oracle');
},{wgslSources:modules});
