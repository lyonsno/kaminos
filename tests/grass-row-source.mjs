// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrassTeacherSource} from '../surface-teacher-source.mjs';
import {createGrassMaterialSource} from '../grass-material-source.mjs';
const row={angle:0,phase:[0,0],span:.75,minHeightFraction:1/6};
const config={periodic:true,blades:6,width:4.8,depth:4.8,height:2.4,bladeWidth:.216,bend:.12,segments:7,row};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
test('row has exact ordered heights, shared width, lean and taper, and an enclosing query plane',()=>{
 const source=createGrassMaterialSource(config);
 assert.equal(source.blades.length,6);
 for(const [i,blade]of source.blades.entries()){
  const root=blade.centres[0],h=2.4*(i+1)/6;
  close(root[0],-1.8+i*.72);close(root[1],0);close(root[2],0);
  close(blade.centres.at(-1)[1],h);close(blade.widths[0],.216);
  for(const [j,c]of blade.centres.entries()){
   const t=j/7;close(c[0],root[0]);close(c[1],h*t);close(c[2],.12*h*t*t);
   close(blade.widths[j],.216*Math.max(.015,(1-t)**.75));
  }
  assert.ok(source.referenceHeight>h);
 }
 const reseeded=createGrassMaterialSource({...config,seed:999});
 assert.deepEqual(source.blades,reseeded.blades);assert.deepEqual(source.triangles,reseeded.triangles);
});
test('height ratios preserve roots and width; diagonal rotates the entire blade row',()=>{
 const a=createGrassTeacherSource(config),b=createGrassTeacherSource({...config,height:4.8}),d=createGrassTeacherSource({...config,row:{...row,angle:Math.PI/4}});
 for(let i=0;i<6;i++){
  assert.deepEqual(a.blades[i].centres[0],b.blades[i].centres[0]);
  assert.deepEqual(a.blades[i].widths,b.blades[i].widths);
  for(let j=0;j<=7;j++){
   const p=a.blades[i].centres[j],q=b.blades[i].centres[j],v=d.blades[i].centres[j];
   close(q[1],2*p[1]);close(q[2],2*p[2]);
   close(v[0],(p[0]-p[2])/Math.SQRT2);close(v[2],(p[0]+p[2])/Math.SQRT2);close(v[1],p[1]);
  }
 }
});
test('edge phases translate unfolded blades and preserve nondegenerate periodic triangles',()=>{
 const a=createGrassTeacherSource(config);
 for(const phase of [[0,-.45],[0,.45]]){
  const b=createGrassTeacherSource({...config,height:4.8,row:{...row,phase}});
  const centre=createGrassTeacherSource({...config,height:4.8});
  for(let i=0;i<6;i++)for(let j=0;j<=7;j++){
   close(b.blades[i].centres[j][0],centre.blades[i].centres[j][0]);
   close(b.blades[i].centres[j][2]-centre.blades[i].centres[j][2],phase[1]*4.8);
  }
  for(const {a:p,b:q,c:r}of b.triangles){
   const u=q.map((x,i)=>x-p[i]),v=r.map((x,i)=>x-p[i]);
   assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>0);
   for(const v of [p,q,r])assert.ok(v[0]>=-2.4-1e-12&&v[0]<=2.4+1e-12&&v[2]>=-2.4-1e-12&&v[2]<=2.4+1e-12);
  }
 }
 assert.equal(a.periodic.width,4.8);
});
test('row rejects ambiguous or invalid layout rather than silently using the random layout',()=>{
 for(const bad of [null,{...row,angle:NaN},{...row,phase:[0]},{...row,span:0},{...row,minHeightFraction:0},{...row,minHeightFraction:1.1}])assert.throws(()=>createGrassTeacherSource({...config,row:bad}),/row/i);
 assert.throws(()=>createGrassTeacherSource({...config,tufts:{}}),/row/i);
});
