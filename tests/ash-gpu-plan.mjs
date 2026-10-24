// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {patchLayout,seedPatch,pairTransfer} from '../ash/gpu-plan.mjs';
test('patch scale retains caller bounds and derives capacity without clipping',()=>{
 const p=patchLayout({cellSize:.012,bounds:{min:[-.9,0,.1],max:[.9,.48,1.9]}});
 assert.deepEqual(p.dims,[150,40,150]);assert.equal(p.count,900000);
 assert.throws(()=>patchLayout({cellSize:0,bounds:p.bounds}),/cell/);
});
test('seeding conserves physical volume and rejects insufficient room before mutation',()=>{
 const p=patchLayout({cellSize:.1,bounds:{min:[0,0,0],max:[1,1,1]}}),solid=new Uint8Array(p.count);
 const a=seedPatch(p,solid,{volume:.03,radius:.3,center:[.5,0,.5]});
 assert.ok(Math.abs(a.reduce((x,y)=>x+y,0)*.001-.03)<1e-8);
 assert.throws(()=>seedPatch(p,solid,{volume:2,radius:.3,center:[.5,0,.5]}),/capacity/);
});
test('pair exchange is conservative, obeys support and pushes out of contact',()=>{
 assert.equal(pairTransfer({a:0,b:.8,axis:1,solidA:false,solidB:false,penetrationA:0,penetrationB:0}),-.8);
 assert.equal(pairTransfer({a:.8,b:0,axis:1,solidA:true,solidB:false,penetrationA:0,penetrationB:0}),0);
 assert.equal(pairTransfer({a:1,b:0,axis:0,solidA:false,solidB:false,penetrationA:2,penetrationB:0}),1);
});
