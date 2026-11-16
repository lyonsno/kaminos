// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedBundleReuse,reprojectBundleReuse} from '../particle-bundle-reuse.mjs';

function scene(step,fn,tau=0){
 const width=9,sections=3;
 const moments=Array.from({length:width*width},(_,i)=>Array.from({length:sections*4},(_,j)=>j%4===3?tau:j%4===0?fn(i%width,Math.floor(i/width),Math.floor(j/4)):0));
 return {identity:{epoch:1,step,materialStamp:'material'},emitter:[0,0,0],receiver:[0,0,3],halfWidth:4.5,width,sections,moments};
}
test('the held and advected arms sample the same sparse paths; dense fresh RGB never leaks into predictions',()=>{
 const old=scene(5,(x,y,z)=>x+2*y+z),history=seedBundleReuse(old,3);
 assert.equal(history.samples.length,27);
 const zero=history.samples.map(p=>[...p.xyz]);
 const a=reprojectBundleReuse(history,zero,scene(6,()=>42)),b=reprojectBundleReuse(history,zero,scene(6,()=>11));
 assert.deepEqual(a.held,a.advected);
 assert.deepEqual(a.advected,b.advected);
 assert.notDeepEqual(a.fresh,b.fresh);
 assert.equal(a.totalPoints,243);
 assert.equal(a.coveredPoints,243);
 assert.equal(history.samples.filter(s=>s.rgb[0]===3).length,1);
});
test('moving a spatial profile improves a straight ray between sampled paths and preserves fixed per-section transmission',()=>{
 const old=scene(5,(x,y,z)=>x+(z+1)*20,Math.log(2)),h=seedBundleReuse(old,3);
 const shifted=h.samples.map(({xyz:[x,y,z]})=>[x+1,y,z]);
 const s=reprojectBundleReuse(h,shifted,scene(6,(x,y,z)=>x-1+(z+1)*20,0));
 const i=5+4*9;
 assert.equal(s.advected[i][2].transmission,.125);
 assert.equal(s.fresh[i][2].transmission,.125);
 assert.equal(s.advected[i][2].light[0],s.fresh[i][2].light[0]);
 assert.notEqual(s.held[i][2].light[0],s.fresh[i][2].light[0]);
});
test('history that leaves the patch exposes holes instead of treating unknown emission as darkness',()=>{
 const h=seedBundleReuse(scene(10,()=>0),3),f=scene(11,()=>1);
 const moved=h.samples.map(p=>p.xyz.map(v=>v+30));
 const p=reprojectBundleReuse(h,moved,f);
 assert.equal(p.coveredPoints,0);
 assert.equal(p.advected[0][2],null);
 assert.equal(p.error,null);
 assert.throws(()=>reprojectBundleReuse(h,moved,{...f,identity:{...f.identity,epoch:2}}),/different material or beam/);
 assert.throws(()=>reprojectBundleReuse(h,moved,scene(10,()=>1)),/later material step/);
});
