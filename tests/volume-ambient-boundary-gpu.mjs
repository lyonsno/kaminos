// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
import {AMBIENT_BOUNDARY_WGSL} from '../volume-ambient-boundary.mjs';

test('authored contact width changes boundary coverage independently of cell width',async()=>withKaminosGpu(async ctx=>{
 const v=await evalWgslBatch(ctx,{preamble:AMBIENT_BOUNDARY_WGSL,argTypes:['f32'],returnType:'f32',body:'return ambientMaterialWallFade(5.0/6.0,1.0/3.0,arg0);',inputs:[[.14],[.28],[0]]});
 for(const [i,expected] of [.79,.58,1].entries())assert.ok(Math.abs(v[i]-expected)<2e-6,`band ${i}: ${v[i]} expected ${expected}`);
}));
test('air exchange response and boundary braking have independent powers and preserve default survival',async()=>withKaminosGpu(async ctx=>{
 const inputs=[[.2,1],[.2,.5],[.2,2],[.2,-1],[.55,0],[.55,1],[.55,4]];
 const v=await evalWgslBatch(ctx,{preamble:AMBIENT_BOUNDARY_WGSL,argTypes:['f32','f32'],returnType:'f32',body:'return ambientRateSurvival(arg0,.79,arg1);',inputs});
 const expected=[.832,Math.sqrt(.832),.832**2,0,1,.9055,.9055**4];for(let i=0;i<v.length;i++)assert.ok(Math.abs(v[i]-expected[i])<2e-6,`rate ${i}: ${v[i]} expected ${expected[i]}`);
}));
