// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceMaterialTeacher} from '../surface-material-teacher.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
test('coherent material grids expose filtered linear labels before training',()=>{
 assert.equal(typeof SurfaceMaterialTeacher.prototype.evaluateMaterialGrid,'function','missing coherent material-grid capture; random query rows cannot be spatially denoised');
});
test('material grid preserves unit-light response, rectangular coordinates and rejects invalid grids',async()=>{
 await withKaminosGpu(async({device})=>{
 const materials=[{color:[.5,.3,.1],roughness:1,metalness:0}];
 const triangles=[{a:[-8,0,-8],b:[8,0,8],c:[8,0,-8],materialIndex:0},{a:[-8,0,-8],b:[-8,0,8],c:[8,0,8],materialIndex:0}];
 const teacher=new SurfaceMaterialTeacher(device,{triangles,materials,environment:0,bounces:1});
 try{
 const config={width:8,height:8,tileWidth:2,tileDepth:1,referenceHeight:.1,resolution:64,samples:4,view:[0,0],light:[.6,0],lod:0,seed:7};
 const grid=await teacher.evaluateMaterialGrid(config);
 assert.equal(grid.queries.length,8*8*8);assert.equal(grid.raw.length,8*8*3);assert.equal(grid.filtered.length,grid.raw.length);
 const reference=await teacher.evaluateMaterial(grid.queries,{tileSize:1,referenceHeight:.1,resolution:64,samples:4,seed:7});
 for(let i=0;i<reference.length;i++){assert.ok(Number.isFinite(grid.filtered[i]));assert.ok(Math.abs(grid.filtered[i]-reference[i])<1e-5);}
 const window=await teacher.evaluateMaterialGrid({...config,uvOrigin:[.2,.3],uvScale:[.25,.5]});
 assert.ok(Math.abs(window.queries[0]-(.2+.25/16))<1e-7);assert.ok(Math.abs(window.queries[1]-(.3+.5/16))<1e-7);
 await assert.rejects(teacher.evaluateMaterialGrid({...config,uvOrigin:[.9,0]}),/UV window/);
 await assert.rejects(teacher.evaluateMaterialGrid({...config,light:[1,0]}),/hemisphere/);
 await assert.rejects(teacher.evaluateMaterialGrid({...config,width:0}),/grid/);
 }finally{teacher.dispose();}
 });
});

test('rectangular capture agrees with raw material queries across a real visibility boundary',async()=>{
 await withKaminosGpu(async({device})=>{
 const materials=[{color:[.5,.3,.1],roughness:1,metalness:0}];
 const triangles=[{a:[-8,0,-8],b:[8,0,.3],c:[8,0,-8],materialIndex:0},{a:[-8,0,-8],b:[-8,0,.3],c:[8,0,.3],materialIndex:0}];
 const teacher=new SurfaceMaterialTeacher(device,{triangles,materials,environment:0,bounces:1});
 try{
 const cfg={width:8,height:8,tileWidth:2,tileDepth:1,referenceHeight:.1,resolution:64,samples:4,view:[0,0],light:[0,0],seed:13};
 const grid=await teacher.evaluateMaterialGrid(cfg),raw=await teacher.evaluateMaterial(grid.queries,{tileSize:2,tileDepth:1,referenceHeight:.1,resolution:64,samples:4,seed:13});
 for(let i=0;i<raw.length;i++)assert.ok(Math.abs(raw[i]-grid.raw[i])<1e-6);
 assert.ok(grid.filtered[0]>.1);assert.equal(grid.filtered.at(-3),0);
 }finally{teacher.dispose();}
 });
});
