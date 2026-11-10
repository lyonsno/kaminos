// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGroundTeacherSource} from '../ground-teacher-source.mjs';
test('ground source contains a continuous matrix and partly buried closed grains with distinct materials',()=>{
 const source=createGroundTeacherSource({seed:41,cells:8,grains:12});
 assert.equal(source.triangles.filter(t=>t.kind==='matrix').length,128);
 assert.equal(source.grains.length,12);
 assert.ok(source.materials.length>=3);
 for(const grain of source.grains){
  assert.ok(grain.bottom<grain.matrixHeight&&grain.top>grain.matrixHeight,'grain must cross the matrix');
  assert.ok(source.triangles.some(t=>t.identity===grain.identity&&t.materialIndex!==0));
 }
 for(const t of source.triangles){
  assert.ok([t.a,t.b,t.c].flat().every(Number.isFinite));
  const a=t.b.map((v,i)=>v-t.a[i]),b=t.c.map((v,i)=>v-t.a[i]);
  assert.ok(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>1e-10);
 }
 assert.deepEqual(source,createGroundTeacherSource({seed:41,cells:8,grains:12}));
 assert.notDeepEqual(source.triangles,createGroundTeacherSource({seed:42,cells:8,grains:12}).triangles);
});
test('invalid source controls fail explicitly',()=>{
 for(const values of [{cells:0},{grains:-1},{relief:NaN},{seed:1.5},{tileSize:0}])assert.throws(()=>createGroundTeacherSource(values),/Invalid/);
});
