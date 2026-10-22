// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurfelGlass} from '../trellis-surfel-glass.mjs';
test('plain and normal views isolate shape without transmission or source tint',()=>{
 const c=createSurfelGlass(new Float32Array([0,0,0,0,0,1,1,.5,0,.1,.2,.3]),{count:1,stride:12,radius:.01});
 for(const mode of ['plain','normals']){c.set({mode});assert.equal(c.read().mode,mode);assert.equal(c.root.children[0].material.transmission,0);}
 c.dispose();
});
test('surfel material rows remain instance-owned with transparent and opaque populations',()=>{
 const data=new Float32Array([0,0,0,0,0,1,1,.5,0,.1,.2,.3, 1,0,0,0,1,0,0,1,0,0,.8,1]);
 const c=createSurfelGlass(data,{count:2,stride:12,radius:.01});
 assert.equal(c.read().count,2);assert.equal(c.root.children.length,2);
 const clear=c.root.children.find(m=>m.userData.transmissive);
 assert.equal(clear.count,1);assert.ok(clear.material.transmissionNode);
 const opaque=c.root.children.find(m=>!m.userData.transmissive);
 assert.equal(opaque.material.transmission,1,'reconstructed wall classification must not depend on source-row opacity');
 c.set({reconstruction:false});assert.equal(opaque.material.transmission,0);
 c.set({reconstruction:true});assert.equal(opaque.material.transmission,1);
 assert.ok(Math.abs(clear.geometry.getAttribute('surfelOpacity').array[0]-.3)<1e-6);
 c.set({mode:'opaque'});assert.equal(clear.material.transmission,0);
 c.set({mode:'glass',thickness:.03});assert.equal(clear.material.transmission,1);
 assert.equal(clear.material.thickness,.03);assert.throws(()=>c.set({thickness:NaN}));
 c.dispose();
});
test('missing or corrupt rows cannot become a plausible surfel asset',()=>{
 assert.throws(()=>createSurfelGlass(new Float32Array(12),{count:2,stride:12,radius:.01}));
 assert.throws(()=>createSurfelGlass(new Float32Array(12).fill(NaN),{count:1,stride:12,radius:.01}));
});
test('surface reconstruction is reversible without changing source opacity',()=>{
 const c=createSurfelGlass(new Float32Array([0,0,0,0,0,1,1,.5,0,.1,.2,.3]),{count:1,stride:12,radius:.01});
 c.set({reconstruction:true});
 assert.equal(c.read().reconstruction,true);
 assert.ok(c.root.children[0].material.normalNode);
 c.set({reconstruction:false});
 assert.equal(c.root.children[0].material.normalNode,null);
 assert.throws(()=>c.set({reconstruction:'yes'}));
 c.dispose();
});
