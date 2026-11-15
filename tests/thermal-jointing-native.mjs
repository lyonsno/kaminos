// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {THERMAL_STONE_WGSL} from '../experiments/thermal-jointing/material-law.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';

const close=(a,b,eps=1e-4)=>assert.ok(Math.abs(a-b)<=eps,`${a} differs from ${b}`);
test('thermal rest change creates restraint stress but permits free contraction',async()=>{
 await withKaminosGpu(async ctx=>{
  const out=await evalWgslBatch(ctx,{
   preamble:THERMAL_STONE_WGSL,argTypes:['f32','f32'],returnType:'vec4<f32>',
   body:`let F=stoneElasticF(arg0*stoneIdentity(),arg1,.03);
    let stress=stoneStress(F,1.,0.,10.,20.);
    return vec4f(stress[0].x,stress[1].y,stress[2].z,stonePositiveEnergy(F,10.,20.));`,
   inputs:[[1,1],[1,0],[.97,0]],
  });
  out[0].forEach(v=>close(v,0));
  assert.ok(out[1][0]>1,'fixed cooled material must carry tensile stress');
  assert.ok(out[1][3]>0,'restrained cooling must supply positive fracture driving energy');
  out[2].forEach(v=>close(v,0));
 });
});

test('damage removes tensile/shear response while preserving compression and irreversible history',async()=>{
 await withKaminosGpu(async ctx=>{
  const out=await evalWgslBatch(ctx,{
   preamble:THERMAL_STONE_WGSL,argTypes:['f32','f32'],returnType:'vec4<f32>',
   body:`let F=arg0*stoneIdentity();let s=stoneStress(F,arg1,0.,10.,20.);
    return vec4f(s[0].x,stonePositiveEnergy(F,10.,20.),stoneHistory(3.,1.),stoneIntact(.4,.8));`,
   inputs:[[1.1,1],[1.1,0],[.9,1],[.9,0]],
  });
  close(out[0][0],10*(1.1**6-1));close(out[1][0],0);
  assert.ok(out[2][0]<0);close(out[2][0],out[3][0]);
  close(out[2][1],0);out.forEach(v=>{close(v[2],3);close(v[3],.4);});
  const shear=await evalWgslBatch(ctx,{
   preamble:THERMAL_STONE_WGSL,argTypes:['f32'],returnType:'vec4<f32>',
   body:`let F=mat3x3f(vec3f(1,0,0),vec3f(.2,1,0),vec3f(0,0,1));let s=stoneStress(F,arg0,0.,10.,20.);
    return vec4f(s[1].x,stonePositiveEnergy(F,10.,20.),0,0);`,inputs:[[1],[0]],
  });
  close(shear[0][0],2);close(shear[0][1],.2);close(shear[1][0],0);
 });
});
