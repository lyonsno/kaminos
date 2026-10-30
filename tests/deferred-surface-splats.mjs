// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeferredSurfaceSplats} from '../deferred-surface-splats.mjs';
test('coverage reconstruction keeps material transmission separate and resolves once per surface layer',()=>{
 const data=new Float32Array([0,0,0,0,0,1,1,.5,0,.2,.3,1, 0,0,-.1,0,0,1,1,.5,0,.2,.3,.2]);
 const footprint=new Float32Array([1,0,0,.01,0,1,0,.01, 1,0,0,.01,0,1,0,.01]);
 const c=createDeferredSurfaceSplats(data,{count:2,stride:12,radius:.03},footprint);
 assert.equal(c.read().count,2);assert.equal(c.read().layers,2);assert.equal(c.read().lightingPrimitives,4);
 assert.equal(c.root.children.length,2);assert.ok(c.root.children.every(m=>m.geometry.index.count===6));
 assert.ok(c.root.children.every(m=>m.material.fragmentNode===null&&m.material.depthNode&&m.material.normalNode));
 c.set({mode:'opaque'});assert.ok(c.root.children.every(m=>m.material.transmission===0));
 c.set({mode:'glass',ior:1.6,thickness:.04});assert.equal(c.read().ior,1.6);assert.equal(c.read().thickness,.04);
 assert.throws(()=>c.set({ior:NaN}));assert.equal(c.read().ior,1.6);
 c.dispose();assert.throws(()=>c.set({mode:'opaque'}),/disposed/);
});
