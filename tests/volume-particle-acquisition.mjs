// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {particleBatch,particleSourceEnvelope,particleProjectedRect,particleAcquisitionData,PARTICLE_ACQUISITION_MATH_WGSL} from '../volume-particle-acquisition.mjs';
import {opticalParticleSettings} from '../volume-optical-particles.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const fine={lo:[-1,-1,-1],hi:[1,1,1]},source={lo:[-.2,-.4,-.1],hi:[.2,.1,.1]};
test('fresh batch fits hardware capacity independently from aspect and retained population',()=>{
 assert.deepEqual(particleBatch(100,.0001,16),{width:7,height:15,samples:100,pixels:105});
 assert.equal(particleBatch(256,1000,16).pixels,256);assert.throws(()=>particleBatch(257,1,16),/dimensions/);
 for(const n of [1,17,8192]){const b=particleBatch(n,16/9,8192);assert.ok(b.pixels>=n&&b.pixels-n<b.width);}
});
test('recent-source support comes from admitted emitter geometry and inlet travel',()=>{
 const e={admitted:true,centreCells:[4,2,4],direction:[0,1,0],radiusCells:1,thickness:2,speed:2};
 const a=particleSourceEnvelope({sources:[{effective:e}],pitch:.25,backtrace:.5,history:4,margin:1});
 assert.deepEqual(a.lo,[-.5,-1,-.5]);assert.deepEqual(a.hi,[.5,1,.5]);assert.equal(a.emitters,1);
 assert.equal(particleSourceEnvelope({sources:[{effective:{...e,admitted:false}}],pitch:.25}),null);
 assert.deepEqual(particleProjectedRect(source,identity),[.4,.3,.6,.55]);
});
function acquisition(settings,phase=0){const b=particleBatch(64,1,16);return particleAcquisitionData({settings:opticalParticleSettings({acquisitionMode:1,...settings}),batch:b,phase,vp:identity,fine,coarse:fine,source});}
function shader(data){const f=new Float32Array(data),u=new Uint32Array(data);return `let a=ParticleAcquisition(vec4<f32>(${[...f.slice(0,4)]}),vec4<f32>(${[...f.slice(4,8)]}),vec4<f32>(${[...f.slice(8,12)]}),vec4<f32>(${[...f.slice(12,16)]}),vec4<f32>(${[...f.slice(16,20)]}),vec4<f32>(${[...f.slice(20,24)]}),vec4<u32>(${[...u.slice(24,28)].map(x=>x+'u')}));`;}
test('production acquisition moves film rays within their strata and source bias confines their intervals',async()=>{
 await withKaminosGpu(async ctx=>{
  const pixels=Array.from({length:64},(_,i)=>[i%8+.5,Math.floor(i/8)+.5]);
  const collect=async settings=>evalWgslBatch(ctx,{preamble:PARTICLE_ACQUISITION_MATH_WGSL,argTypes:['f32','f32'],returnType:'vec4<f32>',body:shader(acquisition(settings))+`let p=vec2<f32>(arg0,arg1);let uv=acquisitionFilm(p,a);let h=acquisitionInterval(p,vec3<f32>(0,0,-2),vec3<f32>(0,0,1),vec2<f32>(1,3),vec2<f32>(0,4),a);return vec4<f32>(uv,h);`,inputs:pixels});
  const a=await collect({sourceBias:1,filmJitter:1}),fixed=await collect({sourceBias:1,filmJitter:0});
  for(let i=0;i<64;i++){assert.ok(a[i][0]>=.4&&a[i][0]<=.6&&a[i][1]>=.3&&a[i][1]<=.55);assert.ok(Math.abs(a[i][2]-1.9)<1e-5&&Math.abs(a[i][3]-2.1)<1e-5);assert.ok(Math.abs(a[i][0]-fixed[i][0])<=.2/16+.00001);}
  assert.ok(a.some((x,i)=>x[0]!==fixed[i][0]||x[1]!==fixed[i][1]),'film-plane samples must actually move');
  const phase1=await evalWgslBatch(ctx,{preamble:PARTICLE_ACQUISITION_MATH_WGSL,argTypes:['f32','f32'],returnType:'vec2<f32>',body:shader(acquisition({sourceBias:1},1))+'return acquisitionFilm(vec2<f32>(arg0,arg1),a);',inputs:pixels});
  assert.ok(a.some((x,i)=>x[0]!==phase1[i][0]),'later simulation steps explore new film positions');
  const none=await collect({sourceBias:0,fineCoverage:0,coarseCoverage:0});assert.ok(none.every(x=>x[3]<x[2]));
  const onlyFine=await collect({sourceBias:0,fineCoverage:1,coarseCoverage:0});assert.ok(onlyFine.every(x=>x[2]===1&&x[3]===3));
 });
});
test('offscreen projected source produces an empty interval rather than fallback coverage',async()=>{
 await withKaminosGpu(async ctx=>{
  const data=particleAcquisitionData({settings:opticalParticleSettings({acquisitionMode:1,sourceBias:1}),batch:{width:1,height:1,samples:1},phase:0,vp:identity,fine,source:{lo:[3,3,-1],hi:[4,4,1]}});
  const r=await evalWgslBatch(ctx,{preamble:PARTICLE_ACQUISITION_MATH_WGSL,argTypes:[],returnType:'vec2<f32>',body:shader(data)+'return acquisitionInterval(vec2<f32>(.5),vec3<f32>(0),vec3<f32>(0,0,1),vec2<f32>(0,1),vec2<f32>(0,2),a);',inputs:[[]]});assert.ok(r[0][1]<r[0][0]);
 });
});
