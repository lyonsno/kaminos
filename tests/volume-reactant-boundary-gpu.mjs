// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,evalWgslBatch,extractWgslFunction} from '../tools/shader-herder.mjs';
import {REACTANT_COMBUSTION_WGSL} from '../volume-reactant-combustion.mjs';

test('standalone ambient-air band intersects resident side and floor cells',async()=>{
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{
   preamble:extractWgslFunction(REACTANT_COMBUSTION_WGSL,'reactantMaterialWallFade'),
   argTypes:['f32','f32'],returnType:'f32',
   body:'return reactantMaterialWallFade(arg0,arg1);',
   inputs:[[5/6,1/3],[.5,1/3],[0,1/3]],
  });
  assert.ok(result[0]<1,'the outer resident cell must exchange with ambient air, rather than exhaust its initial oxygen');
  assert.ok(Math.abs(result[0]-.79)<2e-6,'the fixed 0.14-wide boundary ramp occupies part of this cell');
  assert.equal(result[1],1,'interior material has no sponge');
  assert.equal(result[2],1,'zero wall coordinate has no sponge');
 });
});

test('ambient boundary fade integrates the same fixed ramp across cell widths',async()=>{
 const inputs=[4,6,8,16,64,256].flatMap(n=>[1-1/n,.86,.93,.5].map(wall=>[wall,2/n]));
 const ramp=x=>{const t=Math.max(0,Math.min(1,(x-.86)/.14));return t*t*(3-2*t);};
 const expected=([wall,width])=>{
  const lo=wall-width/2,hi=wall+width/2;
  const stops=[lo,...[.86,1].filter(x=>x>lo&&x<hi),hi];let integral=0;
  for(let i=1;i<stops.length;i++){
   const half=(stops[i]-stops[i-1])/2,mid=(stops[i]+stops[i-1])/2;
   integral+=half*(ramp(mid-half/Math.sqrt(3))+ramp(mid+half/Math.sqrt(3)));
  }
  return 1-integral/width;
 };
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{preamble:extractWgslFunction(REACTANT_COMBUSTION_WGSL,'reactantMaterialWallFade'),argTypes:['f32','f32'],returnType:'f32',body:'return reactantMaterialWallFade(arg0,arg1);',inputs});
  for(let i=0;i<inputs.length;i++){
   assert.ok(Number.isFinite(result[i])&&result[i]>=0&&result[i]<=1);
   assert.ok(Math.abs(result[i]-expected(inputs[i]))<1e-5,JSON.stringify({input:inputs[i],actual:result[i],expected:expected(inputs[i])}));
  }
 });
});
