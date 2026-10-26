// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSurfaceFootprints} from '../surface-splat-footprints.mjs';
import {adaptSurfaceSplats} from '../adaptive-surface-splats.mjs';
const row=(x,y,z=0,alpha=1)=>[x,y,z,0,0,1,.3,.5,.2,0,.6,alpha];
const meta=count=>({count,stride:12,gridSize:1,radius:.1});
const quad=(x,y,z=0)=>[row(x,y,z),row(x+.3,y,z),row(x+.3,y+.3,z),row(x,y+.3,z)];
const faces=(offset=0)=>[offset,offset+1,offset+2,offset,offset+2,offset+3];
test('disconnected parallel surfaces cannot become one splat, even under a smaller requested count',()=>{
 const src=new Float32Array([...quad(0,0),...quad(0,1)].flat()),before=src.slice();
 const result=adaptSurfaceSplats(src,meta(8),new Uint32Array([...faces(),...faces(4)]),{targetCount:1});
 assert.equal(result.meta.count,2);assert.equal(result.meta.adaptive.minimumCount,2);
 assert.equal(result.meta.adaptive.targetExceeded,true);
 assert.deepEqual([...result.parent],[0,0,0,0,1,1,1,1]);assert.deepEqual(src,before);
});
test('refinement spends a fixed count on the bent surface while retaining the smooth one coarsely',()=>{
 const a=quad(0,0),b=quad(4,0);b[2][2]=.8;
 const src=new Float32Array([...a,...b].flat());
 const r=adaptSurfaceSplats(src,meta(8),new Uint32Array([...faces(),...faces(4)]),{targetCount:5});
 assert.equal(r.meta.count,5);
 assert.equal(new Set(r.parent.subarray(0,4)).size,1);
 assert.equal(new Set(r.parent.subarray(4)).size,4);
 assert.deepEqual([...r.factors].sort(),[1,1,1,1,4]);
 assert.equal(r.footprints.length,40);assert.equal(r.depthTolerance.length,5);
 for(const id of r.parent)assert.ok(id<r.meta.count);
 for(let id=0;id<r.meta.count;id++)assert.ok(r.parent.includes(id));
 const again=adaptSurfaceSplats(src,meta(8),new Uint32Array([...faces(),...faces(4)]),{targetCount:5});
 assert.deepEqual(r,again);
});
test('opaque and glass remain distinct even when triangles connect them; full refinement preserves source rows',()=>{
 const rows=quad(0,0);rows[2][11]=.2;rows[3][11]=.2;
 const src=new Float32Array(rows.flat()),triangles=new Uint32Array(faces());
 const coarse=adaptSurfaceSplats(src,meta(4),triangles,{targetCount:1});
 assert.equal(coarse.meta.count,2);assert.notEqual(coarse.parent[0],coarse.parent[2]);
 const fine=adaptSurfaceSplats(src,meta(4),triangles,{targetCount:4});
 assert.deepEqual(fine.data,src);assert.deepEqual([...fine.parent],[0,1,2,3]);
});
test('invalid topology and impossible parameters fail explicitly',()=>{
 const src=new Float32Array(quad(0,0).flat());
 assert.throws(()=>adaptSurfaceSplats(src,meta(4),new Uint32Array([0,1,8]),{targetCount:3}),/triangle/i);
 assert.throws(()=>adaptSurfaceSplats(src,meta(4),new Uint32Array(faces()),{targetCount:0}),/target/i);
});
test('coarser connected hierarchy lowers the floor without merging separate sheets',()=>{
 const src=new Float32Array([row(0,0),row(3,0),row(6,0),row(6,.3),row(3,.3),row(0,.3),...quad(0,1)].flat());
 const tri=new Uint32Array([0,1,5,1,4,5,1,2,4,2,3,4,...faces(6)]);
 const ordinary=adaptSurfaceSplats(src,meta(10),tri,{targetCount:2});
 const coarse=adaptSurfaceSplats(src,meta(10),tri,{targetCount:2,maxFactor:8});
 assert.ok(ordinary.meta.count>2);assert.equal(coarse.meta.count,2);
 assert.equal(new Set(coarse.parent.subarray(0,6)).size,1);
 assert.notEqual(coarse.parent[0],coarse.parent[6]);
 assert.deepEqual(adaptSurfaceSplats(src,meta(10),tri,{targetCount:10,maxFactor:8}).data,src);
});
test('surface-only conversion omits unreferenced points explicitly, preserving source identity',()=>{
 const src=new Float32Array([...quad(0,0),row(7,7)].flat()),before=src.slice(),tri=new Uint32Array(faces());
 const all=adaptSurfaceSplats(src,meta(5),tri,{targetCount:5});assert.equal(all.meta.count,5);
 const surface=adaptSurfaceSplats(src,meta(5),tri,{targetCount:5,surfaceOnly:true});
 assert.equal(surface.meta.count,4);assert.equal(surface.meta.sourceCount,5);
 assert.equal(surface.meta.adaptive.omittedUnreferencedCount,1);
 assert.deepEqual([...surface.parent],[0,1,2,3,0xffffffff]);
 assert.deepEqual(surface.data,src.slice(0,48));assert.deepEqual(src,before);
 assert.ok(surface.footprints.every(Number.isFinite));
 assert.ok(fitSurfaceFootprints(src,surface.data,surface.parent,.1,tri).every(Number.isFinite));
});
