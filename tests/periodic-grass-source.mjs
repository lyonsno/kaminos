// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import{createGrassTeacherSource}from'../surface-teacher-source.mjs';import{createGrassMaterialSource}from'../grass-material-source.mjs';
const area=triangles=>triangles.reduce((sum,t)=>{const a=t.b.map((x,i)=>x-t.a[i]),b=t.c.map((x,i)=>x-t.a[i]);return sum+Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;},0);
test('periodic roots occupy the full tile and crossing geometry is clipped into its canonical cell',()=>{
 const options={seed:31,blades:100,width:2,depth:2,height:2,bladeWidth:.08,bend:2},source=createGrassTeacherSource({...options,periodic:true});
 assert.deepEqual(source.periodic,{width:2,depth:2,minY:0,maxY:Math.max(...source.triangles.flatMap(t=>[t.a[1],t.b[1],t.c[1]]))});
 assert.ok(Math.max(...source.blades.map(b=>Math.abs(b.centres[0][0])))>.46*options.width,'no authored 5% bare-root margin');
 assert.ok(source.triangles.every(t=>[t.a,t.b,t.c].every(p=>Math.abs(p[0])<=1+1e-10&&Math.abs(p[2])<=1+1e-10)));
 const finite=createGrassTeacherSource(options);assert.ok(Math.abs(area(source.triangles)-area(finite.triangles))<1e-9,'periodic clipping must preserve actual surface area');assert.ok(source.triangles.length>finite.triangles.length);
 assert.deepEqual(source,createGrassTeacherSource({...options,periodic:true}));
 const material=createGrassMaterialSource({...options,periodic:true});assert.deepEqual(material.periodic,source.periodic);
});
test('finite source keeps its previous geometry and unknown periodic flags refuse',()=>{
 assert.deepEqual(createGrassTeacherSource({blades:4}).triangles,createGrassTeacherSource({blades:4,periodic:false}).triangles);
 assert.throws(()=>createGrassTeacherSource({blades:4,periodic:'yes'}),/periodic/i);
});
