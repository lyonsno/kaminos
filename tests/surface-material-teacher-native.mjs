// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceMaterialTeacher} from '../surface-material-teacher.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
const materials=[{color:[.5,.3,.1],roughness:1,metalness:0}];
const plane=[{a:[-4,0,-4],b:[4,0,4],c:[4,0,-4],materialIndex:0},{a:[-4,0,-4],b:[-4,0,4],c:[4,0,4],materialIndex:0}];
test('material labels use each query light and undo only the macro cosine used again by the live decoder',async()=>{
 await withKaminosGpu(async ({device})=>{
  const teacher=new SurfaceMaterialTeacher(device,{triangles:plane,materials,lights:[],environment:0,bounces:1});
  try{
   const input=new Float32Array([.5,.5,0,0,0,0,0,0, .5,.5,0,0,.6,0,0,0]);
   const rgb=await teacher.evaluateMaterial(input,{tileSize:1,referenceHeight:.1,resolution:64,samples:1});
   assert.ok(rgb[0]>.1&&rgb[0]>rgb[1]&&rgb[1]>rgb[2]);
   // Independent existing raw-ray route for the same surface and oblique light.
   teacher.setScene({triangles:plane,materials,lights:[{type:'directional',position:[-.6,.8,0],color:[1,1,1]}]});
   const raw=await teacher.evaluate([{origin:[0,.1,0],direction:[0,-1,0]}]);
   for(let c=0;c<3;c++)assert.ok(Math.abs(rgb[3+c]*.8-raw[0][c])<1e-5);
   await assert.rejects(teacher.evaluateMaterial(new Float32Array([.5,.5,0,0,2,0,0,0]),{tileSize:1,referenceHeight:.1,resolution:64,samples:1}),/hemisphere/);
  }finally{teacher.dispose();}
 });
});
test('footprint averages actual geometry and keeps zero, missing and mixed surface responses distinguishable',async()=>{
 await withKaminosGpu(async({device})=>{
  const half=[{a:[-2,0,-2],b:[0,0,2],c:[0,0,-2],materialIndex:0},{a:[-2,0,-2],b:[-2,0,2],c:[0,0,2],materialIndex:0}];
  const teacher=new SurfaceMaterialTeacher(device,{triangles:half,materials,environment:0,bounces:1});
  try{
   const q=new Float32Array([.2,.5,0,0,0,0,0,0, .8,.5,0,0,0,0,0,0, .5,.5,0,0,0,0,0,0]);
   const rgb=await teacher.evaluateMaterial(q,{tileSize:1,referenceHeight:.1,resolution:64,samples:128,seed:7});
   assert.equal(rgb[3],0);assert.ok(rgb[6]>rgb[0]*.3&&rgb[6]<rgb[0]*.7);
   assert.ok(rgb.every(Number.isFinite));
  }finally{teacher.dispose();}
 });
});

test('failed coherent capture retains its entire query batch and grid recipe',async()=>{
 await withKaminosGpu(async({device})=>{
  const triangles=plane.map(t=>({...t,...Object.fromEntries(['a','b','c'].map(k=>[k,[t[k][0]/4,0,t[k][2]/4]]))})),teacher=new SurfaceMaterialTeacher(device,{triangles,materials,periodic:{width:2,depth:2,minY:0,maxY:1},environment:0,bounces:1});
  const recipe={width:2,height:2,tileWidth:2,tileDepth:2,referenceHeight:.5,resolution:64,samples:2,view:[Math.fround(.99999994),Math.fround(.0003)],light:[0,0],seed:43};
  try{await assert.rejects(()=>teacher.evaluateMaterialGrid(recipe),e=>{assert.ok(e.capture);assert.equal(e.capture.width,2);assert.equal(e.capture.seed,43);assert.equal(e.queries.length,32);assert.deepEqual(e.capture.view,recipe.view);return true;});}finally{teacher.dispose();}
 });
});
