// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrassMaterialSource as create} from '../grass-material-source.mjs';
const centres=[[-2,-2],[2,-2],[-2,2],[2,2]],tufts={centres,radius:1.1,grading:'uniform',rimFraction:.2,cuts:[]};
const recipe={periodic:false,seed:31,blades:64,height:1.4,width:8.313843876330612,depth:8.313843876330612,bladeWidth:.18,bend:.45,segments:7,tufts};
const tip=b=>b.centres.at(-1)[1];
test('four deterministic sparse tufts share root identities and radial height grading',()=>{
 const uniform=create(recipe),graded=create({...recipe,tufts:{...tufts,grading:'radial'}});
 for(let i=0;i<64;i++){
  const a=uniform.blades[i],b=graded.blades[i],root=a.centres[0],c=centres[i%4],r2=((root[0]-c[0])**2+(root[2]-c[1])**2)/tufts.radius**2;
  assert.ok(r2<=1+1e-12,'root belongs to its tuft');assert.deepEqual(b.centres[0],root);assert.equal(a.id,b.id);
  assert.ok(Math.abs(tip(b)/tip(a)-(.2+.8*(1-r2)))<1e-12,'graded height follows radial profile');
 }
 assert.equal(uniform.referenceHeight,graded.referenceHeight);assert.deepEqual(graded,create(graded.config));
});
test('root-selected hard cuts clip the stalk rather than rescaling lower geometry',()=>{
 const full=create(recipe),cut=create({...recipe,tufts:{...tufts,cuts:[{min:[-4,-4],max:[4,4],height:.3}]}});
 assert.ok(cut.blades.every(b=>Math.abs(tip(b)-.3)<1e-12));
 assert.ok(cut.triangles.filter(t=>t.materialIndex===1).every(t=>[t.a,t.b,t.c].every(p=>p[1]<=.3)));
 const intact=full.triangles.filter(t=>t.materialIndex===1&&[t.a,t.b,t.c].every(p=>p[1]<=.3));
 const byId=new Map(cut.triangles.map(t=>[t.identity,t]));for(const t of intact)assert.deepEqual(byId.get(t.identity),t);
 assert.deepEqual(full.blades.map(b=>b.centres[0]),cut.blades.map(b=>b.centres[0]));
});
test('hard cut selection has an abrupt boundary and keeps unselected stalks unchanged',()=>{
 const full=create(recipe),cut=create({...recipe,tufts:{...tufts,cuts:[{min:[-4,-4],max:[0,4],height:.4}]}});
 for(let i=0;i<64;i++){const b=full.blades[i];if(b.centres[0][0]<0)assert.ok(Math.abs(tip(cut.blades[i])-.4)<1e-12);else assert.deepEqual(cut.blades[i],b);}
});
test('malformed tuft controls refuse before rendering',()=>{
 for(const bad of [{centres:[]},{radius:0},{grading:'unknown'},{rimFraction:-1},{cuts:[{min:[0,0],max:[1,1],height:0}]}])assert.throws(()=>create({...recipe,tufts:{...tufts,...bad}}),/tuft/i);
});
