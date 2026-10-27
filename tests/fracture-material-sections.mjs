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
