// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMasonrySource} from '../masonry-source.mjs';

test('stone source has finite outward triangles and stable face/edge/corner charts',()=>{
 const source=createMasonrySource({cells:10});
 assert.ok(source.triangles.length>0,'the stone must contain actual source triangles');
 const regions=new Set();
 for(const t of source.triangles){
  assert.equal(t.uv.length,3);assert.ok(t.uv.flat().every(Number.isFinite));
  assert.ok([...t.a,...t.b,...t.c].every(Number.isFinite));regions.add(t.region);
  const u=t.b.map((x,i)=>x-t.a[i]),v=t.c.map((x,i)=>x-t.a[i]);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  assert.ok(Math.hypot(...n)>1e-10,'no degenerate triangles');
  const c=t.a.map((x,i)=>(x+t.b[i]+t.c[i])/3);
  assert.ok(n.reduce((s,x,i)=>s+x*c[i],0)>0,'triangle winding points out of the solid');
 }
 assert.deepEqual([...regions].sort(),['corner','face','margin']);
 assert.deepEqual(createMasonrySource({cells:10}),source,'same authored recipe is reproducible');
});

test('damaged source stays inside its carrier and shares vertices across chart seams',()=>{
 const source=createMasonrySource({cells:10}),plain=createMasonrySource({...source.config,relief:0});
 assert.equal(source.triangles.length,plain.triangles.length);
 let changed=0;const points=new Map();
 for(let i=0;i<source.triangles.length;i++)for(const k of ['a','b','c']){
  const p=source.triangles[i][k],q=plain.triangles[i][k];
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs(p[axis])<=Math.abs(q[axis])+1e-10);
  if(p.some((v,j)=>Math.abs(v-q[j])>1e-8))changed++;
  const key=source.triangles[i].reference[k].map(v=>v.toFixed(8)).join(',');
  if(points.has(key))assert.deepEqual(p,points.get(key),'one source location stays welded across UV charts');
  points.set(key,p);
 }
 assert.ok(changed>0,'relief changes the source geometry');
 assert.deepEqual(createMasonrySource({seed:12,cells:10}).config.seed,12);
 assert.notDeepEqual(createMasonrySource({seed:12,cells:10}).triangles,source.triangles);
});

test('invalid geometry recipes reject without inventing a fallback source',()=>{
 for(const controls of [{width:NaN},{height:-1},{cells:1},{seed:1.2},{bevel:0},{bevel:1},{relief:-.1},{relief:.3}])assert.throws(()=>createMasonrySource(controls),/Invalid masonry/);
});

import * as masonry from '../masonry-source.mjs';
test('source and carrier rays preserve the actual hit, chart and miss distinction',()=>{
 assert.equal(typeof masonry.traceMasonryRay,'function','stone source must expose its actual ray intersections');
 const source=createMasonrySource({cells:12,relief:.035});
 const ray={origin:[.67,1,.43],direction:[0,-4,0]};
 const detailed=masonry.traceMasonryRay(source,ray),carrier=masonry.traceMasonryRay(source,{...ray,surface:'carrier'});
 assert.equal(detailed.hit,true);assert.equal(carrier.hit,true);
 assert.ok(detailed.distance>carrier.distance,'inward relief is encountered after the enclosing carrier');
 assert.ok(detailed.uv.every(Number.isFinite));assert.ok(detailed.normal.every(Number.isFinite));
 assert.ok(['margin','corner'].includes(detailed.region));
 assert.deepEqual(masonry.traceMasonryRay(source,{origin:[3,1,0],direction:[0,-1,0]}),{hit:false});
 assert.deepEqual(masonry.traceMasonryRay(source,{...ray,direction:[0,-1,0]}),detailed,'ray direction is normalized');
 assert.throws(()=>masonry.traceMasonryRay(source,{origin:[0,1,0],direction:[0,0,0]}),/ray/);
});
