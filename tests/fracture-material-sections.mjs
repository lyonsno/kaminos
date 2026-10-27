// kaminos-test: node
import assert from 'node:assert/strict';
import {matchMaterialSections} from '../fracture-material-sections.mjs';
const triangle=(id,points)=>{const min=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))),center=[0,1,2].map(k=>points.reduce((s,p)=>s+p[k],0)/3);return{leaf:{index:id,bounds:{min,max}},points,center,area:.5};};
const a=triangle(0,[[0,0,0],[1,0,0],[0,1,0]]),gap=triangle(1,[[2,0,0],[3,0,0],[2,1,0]]);
assert.equal(matchMaterialSections([a],[gap],[0,0,1]).size,0,'Nearest chunks across a gap do not share material');
const touch=triangle(1,[[1,0,0],[2,0,0],[1,1,0]]);assert.equal(matchMaterialSections([a],[touch],[0,0,1]).size,0,'Edge or point contact has zero cohesive area');
const b=triangle(1,[[.5,0,0],[1.5,0,0],[.5,1,0]]),overlap=[...matchMaterialSections([a],[b],[0,0,1]).values()];
assert.equal(overlap.length,1);assert.ok(Math.abs(overlap[0].area-.125)<1e-12,'Only the actual overlapping section area carries force');
assert.ok(Math.abs(overlap[0].moment[0]/overlap[0].area-2/3)<1e-12);assert.ok(Math.abs(overlap[0].moment[1]/overlap[0].area-1/6)<1e-12);
const reverse={...b,points:[...b.points].reverse()};assert.deepEqual([...matchMaterialSections([a],[reverse],[0,0,-1]).values()],overlap,'Section matching is winding independent');
const full=triangle(1,a.points.map(p=>[...p]));assert.equal([...matchMaterialSections([a],[full],[0,0,1]).values()][0].area,.5);

const translated=t=>({...t,points:t.points.map(p=>[p[2]+7,p[0]+11,p[1]-3])});
const transformed=[...matchMaterialSections([translated(a)],[translated(b)]).values()][0];
assert.ok(Math.abs(transformed.area-.125)<1e-12);assert.ok(Math.abs(transformed.moment[0]/transformed.area-7)<1e-12);
const thin=triangle(1,[[1-1e-5,0,0],[2,0,0],[1-1e-5,1,0]]);assert.ok([...matchMaterialSections([a],[thin]).values()][0].area>0,'A small real section must survive without a minimum-area cutoff');
const away=triangle(1,a.points.map(p=>[p[0],p[1],p[2]+.01]));assert.equal(matchMaterialSections([a],[away]).size,0,'Parallel surfaces at different depths do not share material');

// Observed review reproducer: Float32 retains this gap after translation.
const oblique=[[0,0,0],[2,-2,0],[2,0,-2]],separated=oblique.map(p=>p.map(x=>x+.125));
for(const offset of [0,1e6]){
 const row=(index,points)=>({leaf:{index},points:points.map(p=>p.map(x=>Math.fround(x+offset)))});
 assert.equal(matchMaterialSections([row(0,oblique)],[row(1,separated)]).size,0,'Translation cannot turn a resolvable gap into shared material');
 const same=[...matchMaterialSections([row(0,oblique)],[row(1,oblique)]).values()][0];assert.ok(Math.abs(same.area-Math.sqrt(12))<1e-12);assert.ok(Math.abs(same.moment[0]/same.area-(offset+4/3))<1e-8);
}

// The actual cutter rounds descendant vertices into Float32 buffers.
const {bisectFaces}=await import('../poly-mesh-edit.mjs');
const original=[[0,0,0],[1,1,0],[1,0,1]],sectionPlane={points:original};
const split=bisectFaces({positions:Float32Array.from(original.flat()),indices:Uint32Array.of(0,1,2)},Uint8Array.of(1),{point:[0,.2,0],normal:[0,1,0]}).arrays;
const descendants=Array.from({length:split.indices.length/3},(_,f)=>({leaf:{index:1},sourcePlane:sectionPlane,points:Array.from(split.indices.subarray(f*3,f*3+3),i=>Array.from(split.positions.subarray(i*3,i*3+3)))}));
const restored=[...matchMaterialSections([{leaf:{index:0},sourcePlane:sectionPlane,points:original}],descendants).values()].reduce((sum,p)=>sum+p.area,0);
assert.ok(Math.abs(restored-Math.sqrt(3)/2)<1e-7,'Float32 subdivision must preserve the shared source section');
