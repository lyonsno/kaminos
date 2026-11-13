// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withKaminosGpu,evalWgslBatch,extractWgslFunction,extractWgslBlock} from '../tools/shader-herder.mjs';
import {AMBIENT_BOUNDARY_WGSL} from '../volume-ambient-boundary.mjs';
import {REACTANT_COMBUSTION_WGSL} from '../volume-reactant-combustion.mjs';

test('standalone ambient-air band intersects resident side and floor cells',async()=>{
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{
   preamble:AMBIENT_BOUNDARY_WGSL+extractWgslFunction(REACTANT_COMBUSTION_WGSL,'reactantMaterialWallFade'),
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

test('production velocity-only and empty-cell branches share the reactant boundary fade',async()=>{
 const kernel=extractWgslFunction(readFileSync(new URL('../volume-core.js',import.meta.url),'utf8'),'cs');
 const velocity=extractWgslBlock(kernel,'if (VELOCITY_ONLY)');
 const empty=extractWgslBlock(extractWgslBlock(kernel,'if (neighborMass <= 1e-5)'),'if (!MATERIAL_ONLY)');
 // Only unrelated force/transport inputs are fixed. The boundary calculations
 // below execute verbatim from the two production early-return paths.
 const preamble=AMBIENT_BOUNDARY_WGSL+extractWgslFunction(REACTANT_COMBUSTION_WGSL,'reactantMaterialWallFade')+`
 struct BoundaryUniform {ambient_boundary:vec4<f32>};var<private> u:BoundaryUniform;
 const GRID=6u; const GRID_Y=12u; const VELOCITY_ONLY=true; const MATERIAL_ONLY=false;
 const VELOCITY_UNIT_SCALE=1.0;
 var<private> fluidSrc:array<vec4<f32>,4>;var<private> fluidDst:array<vec4<f32>,4>;
 var<private> probePosition:vec3<f32>;
 var<private> probeFlags:u32;
 fn reactantLawOn()->bool{return (probeFlags&1u)==0u;}
 fn joinedBoundary()->bool{return (probeFlags&2u)!=0u;}
 fn openWorldBoundary()->bool{return (probeFlags&4u)!=0u;}
 fn inflowApertureWeight(c:vec3<i32>)->f32{return 0.0;}
 fn stepRate(x:f32)->f32{return x;}
 fn calibrationCellGain()->f32{return 1.0;}
 fn faceForcesOn()->bool{return true;}
 fn boundVelocity(v:vec3<f32>)->vec3<f32>{return v;}
 fn transportVelocityDamping()->f32{return 1.0;}
 fn sceneClipCharacteristic(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{return b;}
 fn sampleFluidSlotInflow(p:vec3<f32>,slot:u32)->vec4<f32>{return vec4<f32>(1,1,1,0);}
 fn macCormackSlot(c:vec3<i32>,i:u32,b:vec3<f32>,f:vec3<f32>,slot:u32)->vec4<f32>{return vec4<f32>(1,1,1,0);}
 fn forceDeltaStore(c:vec3<i32>,v:vec3<f32>){}
 fn velocityProbe(){let p=probePosition;let cellI=vec3<i32>(0);let reactantOn=reactantLawOn();let immersedSlabWeight=0.0;let microLayer=vec4<f32>(0);var vel=vec3<f32>(1);let base=0u;${velocity}}
 fn emptyProbe()->vec3<f32>{let p=probePosition;let cellI=vec3<i32>(0);let cell=vec3<f32>(0);let backCell=cell;let advectVelocity=vec3<f32>(0);let backtraceScale=1.0;let idx=0u;let macCormack=false;var bypassVel=vec3<f32>(1);${empty}return bypassVel;}
 `;
 await withKaminosGpu(async ctx=>{
  for(const [name,body] of [['velocity-only','velocityProbe();return fluidDst[0].xyz;'],['empty-cell','return emptyProbe();']]){
   const values=await evalWgslBatch(ctx,{preamble,argTypes:['f32','f32','u32'],returnType:'vec3<f32>',body:'u.ambient_boundary=vec4<f32>(.14,1,1,0);probePosition=vec3<f32>(arg0,arg1,0);probeFlags=arg2;'+body,inputs:[[5/6,.5,0],[0,-5/6,0],[0,17/6,0],[0,.5,0],[5/6,.5,1],[5/6,.5,2],[5/6,.5,4]]});
   for(let i=0;i<values.length;i++)for(const component of values[i])assert.ok(Math.abs(component-(i<2?.9055:1))<2e-6,`${name} case ${i}: ${component}`);
  }
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
  const result=await evalWgslBatch(ctx,{preamble:AMBIENT_BOUNDARY_WGSL+extractWgslFunction(REACTANT_COMBUSTION_WGSL,'reactantMaterialWallFade'),argTypes:['f32','f32'],returnType:'f32',body:'return reactantMaterialWallFade(arg0,arg1);',inputs});
  for(let i=0;i<inputs.length;i++){
   assert.ok(Number.isFinite(result[i])&&result[i]>=0&&result[i]<=1);
   assert.ok(Math.abs(result[i]-expected(inputs[i]))<1e-5,JSON.stringify({input:inputs[i],actual:result[i],expected:expected(inputs[i])}));
  }
 });
});
