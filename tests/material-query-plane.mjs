// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceMaterialTeacher} from '../surface-material-teacher.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
test('a raised safe ray origin preserves UV at the declared material sampling plane',async()=>{
 await withKaminosGpu(async({device})=>{
  const triangles=[{a:[-.05,0,-.05],b:[.05,0,.05],c:[.05,0,-.05],materialIndex:0},{a:[-.05,0,-.05],b:[-.05,0,.05],c:[.05,0,.05],materialIndex:0}];
  const teacher=new SurfaceMaterialTeacher(device,{triangles,materials:[{color:[.3,.15,.05],roughness:1,metalness:0}],environment:0,bounces:1});
  try{const q=new Float32Array([.5,.5,.95,0,0,0,0,0]);const original=q.slice();
   const expected=await teacher.evaluateMaterial(q,{tileSize:.1,referenceHeight:.3,samplingPlaneHeight:0,resolution:1024,samples:1});
   assert.ok(expected[0]>.04,'oblique ray must hit the finite patch at the material UV, not shoot past it from the elevated origin');
   assert.deepEqual(q,original,'internal launch-plane adjustment must not mutate learner queries');
   const legacy=await teacher.evaluateMaterial(q,{tileSize:.1,referenceHeight:.3,resolution:1024,samples:1});assert.equal(legacy[0],0,'omitted sampling plane retains legacy launch-plane coordinates');
  }finally{teacher.dispose();}
 });
});
