// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {OPTICAL_STEPPING_WGSL} from '../volume-optical-native.mjs';
import {PARTICLE_SUPPORT_QUADRATURE_WGSL} from '../volume-particle-support-quadrature.mjs';
import {evalWgslBatch,withKaminosGpu} from '../tools/shader-herder.mjs';

test('a held finite smoke support keeps per-ray transfer when split along a material axis',async()=>{
 const preamble=OPTICAL_STEPPING_WGSL+PARTICLE_SUPPORT_QUADRATURE_WGSL;
 // Positions are in the support's local sigma frame; lengths are world units.
 // Include forward/reverse rays, rays through each half only, a finite receiver
 // segment ending inside the support, and a ray outside the finite perimeter.
 const rays=[
  [-4,0,0,4,0,0,8], [4,0,0,-4,0,0,8],
  [1,-4,0,1,4,0,4], [-1,-4,0,-1,4,0,4],
  [0,-4,0,0,4,0,4], [0,0,0,1,0,0,1],
  [3,-4,0,3,4,0,4], [-4,-1,0,4,1,0,8.25],
 ];
 const options={preamble,argTypes:Array(8).fill('f32'),returnType:'vec4<f32>',
  body:`let a=vec3<f32>(arg0,arg1,arg2);let b=vec3<f32>(arg3,arg4,arg5);
  let q=vec4<f32>(0.2,0.1,0.05,0.7);
  return particleSupportTransfer(q,a,b,arg6,2.5,arg7>0.0,0u);`,
  inputs:rays.flatMap(r=>[[...r,0],[...r,1]])};
 // Independent midpoint integration of the continuous coefficient along
 // each whole path, followed by the constant source-function solution.
 function expected(r){
  let sum=0;const count=65536;
  for(let i=0;i<count;i++){
   const t=(i+.5)/count;
   const x=r[0]+(r[3]-r[0])*t,y=r[1]+(r[4]-r[1])*t,z=r[2]+(r[5]-r[2])*t;
   const d2=x*x+y*y+z*z;
   if(d2<=6.25)sum+=Math.exp(-d2/2);
  }
  const tau=.7*sum/count*r[6],transmission=Math.exp(-tau);
  return [0.2,0.1,0.05].map(j=>j/.7*-Math.expm1(-tau)).concat(transmission);
 }
 await withKaminosGpu(async ctx=>{
  const rows=await evalWgslBatch(ctx,options);
  for(let i=0;i<rays.length;i++){
   const [parent,split]=rows.slice(2*i,2*i+2),oracle=expected(rays[i]);
   for(let k=0;k<4;k++){
    assert.ok(Math.abs(parent[k]-oracle[k])<4e-5,`ray ${i} channel ${k}: parent ${parent[k]} versus independent integral ${oracle[k]}`);
    assert.ok(Math.abs(split[k]-parent[k])<2e-6,`ray ${i} channel ${k}: split ${split[k]} versus parent ${parent[k]}`);
   }
  }
  assert.deepEqual(rows[12],[0,0,0,1],'a missed support cannot create opacity or light');
  assert.ok(rows[0][3]<.2,'a bright thin source behind the support keeps its substantial shadow');
 });
});
