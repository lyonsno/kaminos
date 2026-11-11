// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createCorrosionState,advanceCorrosion,serializeCorrosion} from '../coating-corrosion.mjs';
import {createCorrosionSource} from '../corrosion-source.mjs';
test('explicit source derives steel pits, oxide contact and separate coating faces from retained state',()=>{
 const s=createCorrosionState({resolution:8,corrosionRate:0,precipitationRate:0,defects:[{a:[.5,.5],b:[.5,.5],radius:.15}]});s.metalLoss.fill(.05);s.rustIron.fill(.05);s.rustIron[0]=0;advanceCorrosion(s,.01);
 const source=createCorrosionSource(serializeCorrosion(s));assert.ok(source.triangles.some(t=>t.identity.startsWith('steel:')&&t.a[1]<0));assert.ok(source.triangles.some(t=>t.identity.startsWith('oxide:')));assert.ok(source.triangles.some(t=>t.identity.startsWith('paint-back:')));assert.ok(source.triangles.some(t=>t.identity.startsWith('paint-edge:')));
 assert.ok(source.triangles.every(t=>[t.a,t.b,t.c].every(p=>p.every(Number.isFinite))));
 assert.equal(source.process.time,s.time);assert.ok(source.referenceHeight>Math.max(...source.triangles.flatMap(t=>[t.a[1],t.b[1],t.c[1]])));
});
test('materialization has matching periodic height boundaries and does not mutate the retained state',()=>{
 const s=createCorrosionState({resolution:8});advanceCorrosion(s,.2);const value=serializeCorrosion(s),before=JSON.stringify(value),source=createCorrosionSource(value,{width:2.4});
 assert.equal(JSON.stringify(value),before);
 const edge=side=>[...new Set(source.triangles.filter(t=>t.identity.startsWith('steel:')||t.identity.startsWith('oxide:')).flatMap(t=>[t.a,t.b,t.c]).filter(p=>Math.abs(p[0]-side*1.2)<1e-9).map(p=>[p[2],p[1]].join(':')))].sort();assert.ok(edge(-1).length>0);assert.deepEqual(edge(-1),edge(1));
 const cut=createCorrosionSource(value,{showSubstrate:true});assert.ok(!cut.triangles.some(t=>t.identity.startsWith('paint-')));
});
test('steel faces have consistent upward orientation and the reference plane encloses an open rust mound',()=>{
 const s=createCorrosionState({resolution:8});s.opening.fill(1);s.bond.fill(0);s.rustIron[0]=4;s.metalLoss[0]=4;
 const src=createCorrosionSource(serializeCorrosion(s));for(const t of src.triangles.filter(t=>t.identity.startsWith('steel:'))){const u=t.b.map((v,i)=>v-t.a[i]),v=t.c.map((q,i)=>q-t.a[i]);assert.ok(u[2]*v[0]-u[0]*v[2]>0);}
 assert.ok(src.referenceHeight>Math.max(...src.triangles.flatMap(t=>[t.a[1],t.b[1],t.c[1]])));
});
test('opaque oxide replaces the hidden steel face instead of nearly coplanar duplicate surfaces',()=>{
 const s=createCorrosionState({resolution:8});s.rustIron[0]=1e-12;const src=createCorrosionSource(serializeCorrosion(s));
 assert.ok(src.triangles.some(t=>t.identity.startsWith('oxide:0:0:')));assert.ok(!src.triangles.some(t=>t.identity.startsWith('steel:0:0:')));
});
