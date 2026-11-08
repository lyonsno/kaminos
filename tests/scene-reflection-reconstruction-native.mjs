// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {PerspectiveCamera,WebGPUCoordinateSystem,Matrix4,Vector3} from '../lib/three.core.js';
import {SCENE_REFLECTION_RECONSTRUCTION_WGSL} from '../scene-reflection-reconstruction.mjs';
import {withKaminosGpu,evalWgslBatch} from '../tools/shader-herder.mjs';
const matrix=m=>'mat4x4<f32>('+Array.from({length:4},(_,i)=>'vec4<f32>('+m.elements.slice(i*4,i*4+4).map(n=>Number(n).toExponential(12)).join(',')+')').join(',')+')';
test('production history projection distinguishes receiver and virtual reflection parallax, and rejects behind-camera points',async()=>{
 await withKaminosGpu(async ctx=>{
  const camera=new PerspectiveCamera(60,1,.1,100);camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();const transform=new Matrix4().makeTranslation(.2,0,0);
  const inputs=[[0,-4],[2,-4],[2,4]];
  const result=await evalWgslBatch(ctx,{preamble:SCENE_REFLECTION_RECONSTRUCTION_WGSL,argTypes:['f32','f32'],returnType:'vec3<f32>',inputs,body:`return reflectionPreviousUV(vec3<f32>(0.0,0.0,arg1),arg0,${matrix(transform)},${matrix(camera.projectionMatrix)});`});
  for(let i=0;i<2;i++){const p=new Vector3(0,0,-4-inputs[i][0]).applyMatrix4(transform).applyMatrix4(camera.projectionMatrix);assert.ok(Math.abs(result[i][0]-(p.x*.5+.5))<1e-5);assert.ok(Math.abs(result[i][1]-(.5-p.y*.5))<1e-5);assert.equal(result[i][2],1);}
  assert.ok(result[0][0]>result[1][0]);assert.equal(result[2][2],0);assert.ok(result[2].every(Number.isFinite));
 });
});
test('production geometry validation rejects disoccluded depth, flipped normals and incompatible roughness',async()=>{
 await withKaminosGpu(async ctx=>{
  const result=await evalWgslBatch(ctx,{preamble:SCENE_REFLECTION_RECONSTRUCTION_WGSL,argTypes:['f32','f32','f32'],returnType:'f32',inputs:[[4,1,.3],[5,1,.3],[4,-1,.3],[4,1,.8]],body:'return reflectionGeometryWeight(arg0,4.0,vec3<f32>(0.0,0.0,arg1),vec3<f32>(0.0,0.0,1.0),arg2,0.3);'});
  assert.equal(result[0],1);assert.deepEqual(result.slice(1),[0,0,0]);
 });
});
test('production logarithmic moments survive half-float storage across HDR and scene-distance ranges',async()=>{
 await withKaminosGpu(async ctx=>{
  const inputs=[[0],[.02],[50],[1e6],[1e12]],result=await evalWgslBatch(ctx,{preamble:SCENE_REFLECTION_RECONSTRUCTION_WGSL,argTypes:['f32'],returnType:'f32',inputs,body:'let packed=unpack2x16float(pack2x16float(vec2<f32>(reflectionEncodeMoment(arg0),0.0)));return reflectionDecodeMoment(packed.x);'});
  for(let i=0;i<inputs.length;i++){assert.ok(Number.isFinite(result[i]));assert.ok(Math.abs(result[i]-inputs[i][0])<=Math.max(1e-5,inputs[i][0]*.02));}
 });
});
