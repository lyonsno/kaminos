// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrassTeacherSource} from '../surface-teacher-source.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';

test('fixed grass has connected tapered blades, backing, and enough lateral extent',()=>{
 const source=createGrassTeacherSource({seed:31,blades:48,height:0.8,width:2.4,depth:1.8});
 assert.ok(source.triangles.length>48*2,'explicit strand surfaces must exist');
 assert.equal(source.blades.length,48);
 for(const blade of source.blades){
  assert.equal(blade.centres[0][1],0);
  assert.ok(blade.centres.at(-1)[1]>0.4);
  assert.ok(blade.widths.at(-1)<blade.widths[0]*0.1);
 }
 assert.ok(source.config.width>=source.config.height*1.5);
 const bvh=buildTriangleVisibility(source.triangles);
 const hit=bvh.trace([0,2,0],[0,-1,0]);
 assert.ok(hit&&hit.distance>0&&hit.distance<=2);
 assert.ok(source.triangles.some(t=>t.materialIndex===0));
 assert.ok(source.triangles.some(t=>t.materialIndex===1));
});
test('seed and configuration reproduce geometry; height changes preserve root positions',()=>{
 const first=createGrassTeacherSource({seed:7,blades:12});
 assert.deepEqual(first,createGrassTeacherSource({seed:7,blades:12}));
 const taller=createGrassTeacherSource({seed:7,blades:12,height:1.2});
 assert.notDeepEqual(first.triangles,taller.triangles);
 assert.deepEqual(first.blades.map(b=>b.centres[0]),taller.blades.map(b=>b.centres[0]));
});
test('invalid controls reject before constructing a source',()=>{
 for(const config of [{blades:-1},{blades:1.5},{height:0},{width:NaN},{depth:0},{seed:Infinity}]){
  assert.throws(()=>createGrassTeacherSource(config));
 }
});
