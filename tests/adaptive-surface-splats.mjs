// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
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
