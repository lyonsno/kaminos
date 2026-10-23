// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSurfaceFootprints} from '../surface-splat-footprints.mjs';
const row=(x,y,n=[0,0,1])=>[x,y,0,...n,1,.5,0,0,.3,1];
test('source support fits tangent ellipses without shifting the retained surface centre',()=>{
 const src=new Float32Array([...row(-.03,0),...row(.03,0),...row(0,-.002),...row(0,.002)]),r=new Float32Array(row(0,0));
 const f=fitSurfaceFootprints(src,r,new Uint32Array(4),.002);
 assert.equal(f.length,8);assert.ok(f[3]>f[7]*3,'elongated source support needs an elongated ellipse');
 assert.ok(Math.abs(f[0])>.99);assert.ok(Math.abs(f[6])<1e-6,'tangent axes remain perpendicular to normal');
 assert.deepEqual([...r],row(0,0).map(Math.fround));
 assert.throws(()=>fitSurfaceFootprints(src,r,new Uint32Array([0,0,0,1]),.002));
});
