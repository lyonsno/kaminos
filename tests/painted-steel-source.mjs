// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaintedSteelSource,paintedSteelSupport} from '../painted-steel-source.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
test('painted steel supplies deterministic shallow explicit flakes and exposed substrate',()=>{
 const a=createPaintedSteelSource({seed:19});assert.deepEqual(a,createPaintedSteelSource({seed:19}));
 assert.ok(a.triangles.length>500);assert.ok(a.patches.length>=4);
 assert.ok(a.triangles.some(t=>t.materialIndex===0));assert.ok(a.triangles.some(t=>t.materialIndex===1));
 assert.ok(a.triangles.some(t=>t.materialIndex===2));
 const points=a.triangles.flatMap(t=>[t.a,t.b,t.c]);assert.ok(points.flat().every(Number.isFinite));
 assert.ok(Math.max(...points.map(p=>p[1]))<.15);
 const bvh=buildTriangleVisibility(a.triangles);
 for(const p of a.patches){const hit=bvh.trace([p.center[0],1,p.center[1]],[0,-1,0]);assert.ok(hit&&hit.distance>0&&hit.distance<1.01);}
});
test('support covers every lifted flake and can be displayed without changing geometry',()=>{
 const a=createPaintedSteelSource(),b=createPaintedSteelSource({showMask:true});
 assert.deepEqual(a.triangles.map(t=>[t.a,t.b,t.c]),b.triangles.map(t=>[t.a,t.b,t.c]));
 assert.notDeepEqual(a.triangles.map(t=>t.materialIndex),b.triangles.map(t=>t.materialIndex));
 for(const t of a.triangles.filter(t=>t.identity.startsWith('flake:')))for(const p of [t.a,t.b,t.c])assert.equal(paintedSteelSupport(a.config,p[0],p[2]),true);
 assert.equal(paintedSteelSupport(a.config,a.config.width/2,a.config.depth/2),false);
});
test('invalid dimensions and counts reject before geometry allocation',()=>{
 for(const c of [{height:-1},{width:0},{patches:0},{seed:NaN},{supportMargin:-.1}])assert.throws(()=>createPaintedSteelSource(c));
});
test('large collars construct contained nonoverlapping holes rather than escaping the tile',()=>{
 const source=createPaintedSteelSource({seed:126,patches:4,width:2,depth:2,supportMargin:.165});
 for(const t of source.triangles)for(const p of [t.a,t.b,t.c])assert.ok(Math.abs(p[0])<=1&&Math.abs(p[2])<=1,`escaped: ${p}`);
});
