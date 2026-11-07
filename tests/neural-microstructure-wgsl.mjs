// kaminos-test: node
import assert from 'node:assert/strict';
import {MICRO_DISC_WGSL} from '../neural-microstructure-core.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';

const cases=[
  {o:[0,0,1],d:[0,0,-1],p:[0,0,0],n:[0,0,1],r:.1,t:1},
  {o:[.5,0,1],d:[0,0,-1],p:[0,0,0],n:[0,0,1],r:.1,t:-1},
  {o:[0,0,1],d:[1,0,0],p:[0,0,0],n:[0,0,1],r:.1,t:-1},
  {o:[0,0,1],d:[0,0,1],p:[0,0,0],n:[0,0,1],r:.1,t:-1},
  {o:[0,0,1],d:[0,0,-2],p:[0,0,0],n:[0,0,2],r:.1,t:.5},
  {o:[-1,0,1],d:[1,0,-1],p:[0,0,0],n:[0,0,-1],r:.1,t:1},
];
const body=r=>`return micro_disc_hit(vec3<f32>(arg0,arg1,arg2),vec3<f32>(arg3,arg4,arg5),vec3<f32>(arg6,arg7,arg8),vec3<f32>(arg9,arg10,arg11),${r});`;
const check=results=>cases.forEach((c,i)=>assert.ok(Math.abs(results[i]-c.t)<1e-6,`disc ${i}: expected ${c.t}, got ${results[i]}`));
await withKaminosGpu(async ctx=>{
  const options={preamble:MICRO_DISC_WGSL,argTypes:Array(13).fill('f32'),returnType:'f32',inputs:cases.map(c=>[...c.o,...c.d,...c.p,...c.n,c.r])};
  check(await evalWgslBatch(ctx,{...options,body:body('arg12')}));
  const filledGap=await evalWgslBatch(ctx,{...options,body:body('100.0')});
  assert.throws(()=>check(filledGap),/disc 1/,'The oracle must reject a valid shader that fills a real gap');
});
console.log('microstructure WGSL: native disc intersections and false solid-coverage control passed');
