// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceTeacher} from '../surface-teacher.mjs';
import {withKaminosGpu,evalWgslBatch,extractWgslFunction} from '../tools/shader-herder.mjs';
import {SURFACE_TEACHER_COMMON_WGSL,SURFACE_TEACHER_HISTORY_WGSL} from '../surface-teacher-wgsl.mjs';
import {PerspectiveCamera,WebGPUCoordinateSystem,Matrix4} from '../lib/three.core.js';

test('production teacher query sees a lit surface, geometric shadow, and a miss',async()=>{
 await withKaminosGpu(async ctx=>{
  const ground=[{a:[-2,0,-2],b:[2,0,2],c:[2,0,-2],materialIndex:0},{a:[-2,0,-2],b:[-2,0,2],c:[2,0,2],materialIndex:0}];
  const options={triangles:ground,materials:[{color:[.5,.3,.1],roughness:1,metalness:0}],lights:[{position:[0,1,0],color:[3,3,3],type:'directional'}],environment:0,bounces:1};
  let teacher=new SurfaceTeacher(ctx.device,options);
  const queries=[{origin:[0,1,0],direction:[0,-1,0]},{origin:[3,1,0],direction:[0,-1,0]}];
  const [open,miss]=await teacher.evaluate(queries);
  assert.ok(open[0]>.4&&open[0]>open[1]&&open[1]>open[2],'linear color must include direct material response');
  assert.deepEqual(miss.slice(0,3),[0,0,0]);teacher.dispose();
  // Vertical blocker shadows the receiver from an oblique directional light,
  // while remaining out of the downward camera ray.
  const blocker=[{a:[.3,0,-1],b:[.3,1,-1],c:[.3,1,1],materialIndex:0},{a:[.3,0,-1],b:[.3,1,1],c:[.3,0,1],materialIndex:0}];
  const light=[{position:[1,1,0],color:[3,3,3],type:'directional'}];
  teacher=new SurfaceTeacher(ctx.device,{...options,triangles:[...ground,...blocker],lights:light});
  const blocked=(await teacher.evaluate([queries[0]]))[0];teacher.dispose();
  assert.ok(blocked[0]<.0001,'shadow ray must hit the actual blocker');
 });
});

test('production geometric primitives handle parallel rays and two-sided triangle hits',async()=>{
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{preamble:SURFACE_TEACHER_COMMON_WGSL,argTypes:['f32'],returnType:'vec4<f32>',inputs:[[0],[1]],body:'let sign=select(1.0,-1.0,arg0>0.5);let hit=rayTriangle(vec3<f32>(.2,.2,sign),vec3<f32>(0,0,-sign),vec3<f32>(0),vec3<f32>(1,0,0),vec3<f32>(0,1,0));let box=rayBox(vec3<f32>(2,0,0),vec3<f32>(0,1,0),vec3<f32>(-1),vec3<f32>(1),10.0);return vec4<f32>(hit,select(0.0,1.0,box));'});
  for(const row of result){assert.ok(Math.abs(row[0]-1)<1e-6);assert.ok(Math.abs(row[1]-.2)<1e-6);assert.ok(Math.abs(row[2]-.2)<1e-6);assert.equal(row[3],0);}
 });
});

test('production temporal validation rejects a newly exposed or differently oriented surface',async()=>{
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{preamble:extractWgslFunction(SURFACE_TEACHER_HISTORY_WGSL,'historyCompatible'),argTypes:['f32','f32','f32'],returnType:'f32',inputs:[[0,1,1],[.2,1,1],[0,-1,1],[0,1,2]],body:'let ok=historyCompatible(vec4<f32>(0,0,0,1),vec4<f32>(0,1,0,1),vec4<f32>(arg0,0,0,1),vec4<f32>(0,arg1,0,arg2),.01);return select(0.0,1.0,ok);'});
  assert.deepEqual(result,[1,0,0,0]);
 });
});
test('production image passes retain raw means and reset source-dependent history',async()=>{
 await withKaminosGpu(async ctx=>{
  const source={triangles:[{a:[-2,0,-2],b:[2,0,2],c:[2,0,-2],materialIndex:0},{a:[-2,0,-2],b:[-2,0,2],c:[2,0,2],materialIndex:0}],materials:[{color:[.5,.3,.1],roughness:1,metalness:0}],lights:[{type:'directional',position:[0,1,0],color:[3,3,3]}],environment:.1,bounces:2};
  const teacher=new SurfaceTeacher(ctx.device,source);
  try{
   const options={view:{position:[0,2,2],target:[0,0,0],up:[0,1,0],fov:45},width:16,height:12};
   teacher.render({...options,filter:true});teacher.render({...options,filter:false});
   const pixels=await teacher.readLinear();assert.ok(pixels.every(Number.isFinite));
   assert.ok(pixels.some((v,i)=>i%4===0&&v>.2));
   assert.ok(pixels.every((v,i)=>i%4!==3||v===2),'stationary pixels accumulate exactly two raw samples');
   teacher.setTransport({environment:.2,bounces:2});teacher.render(options);
   const reset=await teacher.readLinear();assert.ok(reset.every((v,i)=>i%4!==3||v===1));
  }finally{teacher.dispose();}
 });
});
test('native-style spot cones illuminate their interior and reject rays outside, including hard edges',async()=>{
 await withKaminosGpu(async ctx=>{
  const scene={triangles:[{a:[-3,0,-3],b:[3,0,3],c:[3,0,-3],materialIndex:0},{a:[-3,0,-3],b:[-3,0,3],c:[3,0,3],materialIndex:0}],materials:[{color:[.5,.5,.5],roughness:.8,metalness:0}],environment:0,bounces:1};
  for(const penumbra of [0,.3]){
   const teacher=new SurfaceTeacher(ctx.device,{...scene,lights:[{type:'spot',position:[0,2,0],direction:[0,-1,0],angle:.3,penumbra,color:[20,20,20]}]});
   try{const result=await teacher.evaluate([{origin:[0,1,0],direction:[0,-1,0]},{origin:[2,1,0],direction:[0,-1,0]}]);assert.ok(result[0][0]>.1);assert.ok(result[1][0]<.0001);assert.ok(result.flat().every(Number.isFinite));}finally{teacher.dispose();}
  }
 });
});
test('image rays consume the shared camera projection, including offsets beyond a plain FOV',async()=>{
 await withKaminosGpu(async ctx=>{
  const camera=new PerspectiveCamera(40,1,.01,100);camera.coordinateSystem=WebGPUCoordinateSystem;camera.position.set(0,2,2);camera.lookAt(0,5,0);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
  const cameraFrame={viewProjection:new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements,position:camera.position.toArray()};
  const teacher=new SurfaceTeacher(ctx.device,{triangles:[{a:[-10,0,-10],b:[10,0,10],c:[10,0,-10],materialIndex:0},{a:[-10,0,-10],b:[-10,0,10],c:[10,0,10],materialIndex:0}],materials:[{color:[.8,.1,.01],roughness:.8,metalness:0}],lights:[],environment:.1,bounces:1});
  try{
   teacher.render({view:{position:[0,2,2],target:[0,0,0],fov:40},cameraFrame,width:8,height:8,filter:false});
   const image=await teacher.readLinear();for(let i=0;i<image.length;i++)if(i%4!==3)assert.ok(Math.abs(image[i]-.1)<1e-6,'actual upward camera frame must see environment, not the downward reconstruction');
  }finally{teacher.dispose();}
 });
});
test('production raw accumulation restarts at one after camera motion and then counts exact new samples',async()=>{
 await withKaminosGpu(async ctx=>{
  const teacher=new SurfaceTeacher(ctx.device,{triangles:[{a:[-20,0,-20],b:[20,0,20],c:[20,0,-20],materialIndex:0},{a:[-20,0,-20],b:[-20,0,20],c:[20,0,20],materialIndex:0}],materials:[{color:[.5,.3,.1],roughness:.8,metalness:0}],lights:[],environment:.1,bounces:2});
  const a={position:[0,2,2],target:[0,0,0],fov:45},b={...a,position:[.001,2,2]};
  try{
   for(const view of [a,a,a,b,b])teacher.render({view,width:8,height:8,filter:true});
   const fresh=await teacher.readLinear();assert.equal(teacher.state().samples,1);assert.ok(fresh.every((v,i)=>i%4!==3||v===1));
   teacher.render({view:b,width:8,height:8,filter:true});const next=await teacher.readLinear();assert.equal(teacher.state().samples,2);assert.ok(next.every((v,i)=>i%4!==3||v===2));
  }finally{teacher.dispose();}
 });
});
