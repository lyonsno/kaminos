// kaminos-test: node
import assert from 'node:assert/strict';
import {Group,Vector3} from '../lib/three.core.js';
const fill=await import('../stage-fill.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
assert.equal(typeof fill.stageFillQuery,'function','Stage mold needs a letter-volume query');
const rows=Array.from({length:96},(_,z)=>z>=20&&z<40?'##..##..##':'##########');
const root=new Group();root.userData.kaminosStageMold={schema:'kaminos.stage-mold.v1',label:'AB',pitch:.1,wallHeight:.2,baseThickness:.1,rows};
root.position.set(2,3,4);root.rotation.y=.4;root.scale.set(2,1,3);
const q=fill.stageFillQuery(root);
assert.equal(q.regions.length,2);assert.ok(Math.abs(q.regions[0].capacityVolume-.48)<1e-9);
const p=new Vector3(-.2,.1,-2).applyMatrix4(root.matrixWorld).toArray();
assert.equal(fill.regionAt(q,p),1);
assert.equal(fill.regionAt(q,new Vector3(0,.1,-2).applyMatrix4(root.matrixWorld).toArray()),0,'solid space between letters is not fluid capacity');
assert.equal(fill.regionAt(q,new Vector3(-.2,.3,-2).applyMatrix4(root.matrixWorld).toArray()),0,'overflow above the walls does not fill a letter');
assert.equal(fill.regionAt(q,new Vector3(-.2,.1,2.5).applyMatrix4(root.matrixWorld).toArray()),0,'runner water is not letter water');
const reading=fill.stageFillReading(q,{counts:[6,3],particleVolume:.04,step:12});
assert.ok(Math.abs(reading.regions[0].fraction-.5)<1e-9);assert.ok(Math.abs(reading.regions[1].fraction-.25)<1e-9);
assert.throws(()=>fill.stageFillReading(q,{counts:[6],particleVolume:.04,step:12}),/count/);
console.log('Letter volume respects strokes, wall height and world transform');
