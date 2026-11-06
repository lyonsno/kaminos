// kaminos-test: node
import assert from 'node:assert/strict';
import {CONTACT_INITIALIZATION_WGSL} from '../fracture-contact-initialization.mjs';
import {evalWgslBatch,withKaminosGpu} from '../tools/shader-herder.mjs';

const inputs=[[1,1/60,1,1],[1/49.19247490740111,1/60,1,1],[2,1/60,1,1],[1,1/120,1,1],[0,1/60,1,1],[1,0,1,1],[1,1/60,1,0],[1,1/60,1e9,1]];
const expected=[3600,49.19247490740111*3600,1800,14400,1,1,1,1e9];
await withKaminosGpu(async ctx=>{
 const result=await evalWgslBatch(ctx,{preamble:CONTACT_INITIALIZATION_WGSL,argTypes:['f32','f32','f32','u32'],returnType:'f32',body:'return contactInitialPenalty(arg0,arg1,arg2,arg3);',inputs});
 result.forEach((x,i)=>assert.ok(Number.isFinite(x)&&Math.abs(x-expected[i])<=Math.max(1e-5,expected[i]*1e-6),`Fresh contact penalty must follow effective mass/substep inertia: case ${i}, ${x} != ${expected[i]}`));
 assert.ok(Math.abs(result[3]/result[0]-4)<1e-6,'Half substep changes inertial scale by four');
},{wgslSources:[{label:'contact-inertial-initialization',code:CONTACT_INITIALIZATION_WGSL+'\n@group(0) @binding(0) var<storage,read_write> result:array<f32>;@compute @workgroup_size(1) fn main(){result[0]=contactInitialPenalty(1.0,1.0,1.0,1u);}',entryPoint:'main'}]});
