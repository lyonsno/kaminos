// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {SCENE_REFLECTION_QUERY_WGSL} from '../scene-reflection-query.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
test('production GGX directions remain finite at both tangent-frame poles',async()=>{
 await withKaminosGpu(async ctx=>{
  const options={preamble:SCENE_REFLECTION_QUERY_WGSL,argTypes:['f32','f32','f32','f32'],returnType:'vec3<f32>',inputs:[[1,.001,.25,0],[-1,.001,.25,0],[1,.5,.33,.66],[-1,.8,.91,.5]],body:'let n=vec3<f32>(0.0,0.0,arg0); return reflectionGGX(n,n,arg1,vec2<f32>(arg2,arg3));'};
  const directions=await evalWgslBatch(ctx,options);
  const check=values=>{for(const d of values){assert.ok(d.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...d)-1)<.00001);}};
  check(directions);assert.deepEqual(directions[0],[0,0,1]);assert.deepEqual(directions[1],[0,0,-1]);
  const broken=await evalWgslBatch(ctx,{...options,body:'let n=vec3<f32>(0.0,0.0,arg0); return reflectionGGX(n,n,arg1,vec2<f32>(arg2,arg3))*2.0;'});
  assert.throws(()=>check(broken),'valid-WGSL normalization fault must be detected');
 });
});
test('production source footprint retains mirror detail and follows distance and projection',async()=>{
 await withKaminosGpu(async ctx=>{
  const call='reflectionSourceLevel(vec3<f32>(0.0,0.0,1.0),vec3<f32>(0.0,0.0,1.0),vec3<f32>(0.0,0.0,1.0),arg0,vec3<f32>(0.0,0.0,arg2),vec3<f32>(0.0,0.0,-1.0),arg1,mat4x4<f32>(vec4<f32>(1.0,0.0,0.0,0.0),vec4<f32>(0.0,1.0,0.0,0.0),vec4<f32>(0.0,0.0,1.0,0.0),vec4<f32>(0.0,0.0,0.0,1.0)),vec2<u32>(512u))';
  const options={preamble:SCENE_REFLECTION_QUERY_WGSL,argTypes:['f32','f32','f32'],returnType:'f32',inputs:[[.001,1,-4],[.35,1,-4],[.35,4,-4],[.35,1,-8]],body:`return ${call};`};
  const check=levels=>{assert.ok(levels.every(Number.isFinite));assert.equal(levels[0],0);assert.ok(levels[1]>0);assert.ok(Math.abs(levels[2]-levels[1]-2)<.0001);assert.ok(Math.abs(levels[1]-levels[3]-1)<.0001);};
  check(await evalWgslBatch(ctx,options));
  const faulty=await evalWgslBatch(ctx,{...options,body:`return 2.0*${call};`});assert.throws(()=>check(faulty),'valid-WGSL footprint scale fault must be rejected');
 });
});

test('production stable glossy sample sets cover the lobe and do not change with the frame',async()=>{
 await withKaminosGpu(async ctx=>{
  const options={preamble:SCENE_REFLECTION_QUERY_WGSL,argTypes:['u32','u32','u32'],returnType:'vec2<f32>',inputs:Array.from({length:16},(_,i)=>[i%8,Math.floor(i/8)*77,1]),body:'return reflectionSamplePoint(arg0,8u,vec2<u32>(137u,219u),arg1,arg2!=0u);'};
  const points=await evalWgslBatch(ctx,options);
  assert.deepEqual(points.slice(0,8),points.slice(8));
  assert.equal(new Set(points.slice(0,8).map(p=>p[0])).size,8);assert.equal(new Set(points.slice(0,8).map(p=>p[1])).size,8);
  for(const p of points)assert.ok(p.every(v=>v>0&&v<1));
  const varying=await evalWgslBatch(ctx,{...options,inputs:options.inputs.map(([i,f])=>[i,f,0])});
  assert.notDeepEqual(varying.slice(0,8),varying.slice(8));
 });
});
