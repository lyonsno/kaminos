// kaminos-test: node
import assert from 'node:assert/strict';
import {EarthSpecimen} from '../earth-specimen.mjs';
import {createEarthField,createEarthTeacherSource} from '../earth-surface.mjs';
const earth=new EarthSpecimen({columns:4,layers:2,grains:2});
const snapshot=earth.snapshot(),field=createEarthField(snapshot);
assert.ok(field.value(...snapshot.particles[15].position)>0,'the implicit matrix must contain its represented material');
assert.ok(field.value(2,2,2)<0,'empty space stays outside');
const source=createEarthTeacherSource({snapshot,resolution:12,halo:0});
assert.ok(source.triangles.some(t=>t.materialIndex===0),'matrix extraction must produce actual triangles');
assert.equal(source.triangles.filter(t=>t.kind==='grit').length,snapshot.grit.length*20,'retain complete explicit grit geometry');
for(const t of source.triangles){assert.ok([...t.a,...t.b,...t.c].every(Number.isFinite));const u=t.b.map((v,k)=>v-t.a[k]),v=t.c.map((v,k)=>v-t.a[k]);assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-14,'no zero-area triangles');}
assert.equal(source.config.snapshot.time,snapshot.time,'teacher carries actual frozen state');
assert.match(source.boundary,/bounded/i);
assert.throws(()=>createEarthTeacherSource({snapshot:{...snapshot,schema:'wrong'},resolution:12}),/schema/i);
assert.throws(()=>createEarthTeacherSource({snapshot,resolution:0}),/resolution/i);
assert.throws(()=>createEarthTeacherSource({snapshot,resolution:12,halo:-1}),/halo/i);
const repeat=createEarthTeacherSource({snapshot,resolution:12,halo:1});
assert.equal(repeat.triangles.length,source.triangles.length*9,'finite halo repeats the complete source');
console.log('implicit matrix, complete mesh/grit, frozen identity, invalid input and halo checks pass');

const dense=structuredClone(snapshot);dense.config.grains=3000;dense.grit=Array.from({length:3000},()=>structuredClone(snapshot.grit[0]));
dense.embeddings=Array.from({length:3000},(_,grain)=>snapshot.embeddings.filter(e=>e.grain===0).map(e=>({...e,grain}))).flat();
const denseSource=createEarthTeacherSource({snapshot:dense,resolution:2});assert.equal(denseSource.triangles.filter(t=>t.kind==="grit").length,60000);assert.ok(Number.isFinite(denseSource.referenceHeight));

assert.throws(()=>createEarthTeacherSource({snapshot,resolution:12,maxTriangles:1}),/storage/,'actual emitted triangles must enforce memory allowance');
