// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {patchLayout,seedPatch} from '../ash/gpu-plan.mjs';
const layout=patchLayout({cellSize:1,bounds:{min:[0,0,0],max:[3,6,1]},tileSize:2});
test('blanket covers every floor and raised support, retaining air under a bridge',()=>{
 const solid=new Uint8Array(layout.count);solid[1+3*2]=1;solid[2+3*3]=1;
 const values=seedPatch(layout,solid,{blanketDepth:1.25});
 assert.deepEqual(Array.from(values),[1,1,1,.25,.25,.25,0,0,0,0,1,0,0,.25,1,0,0,.25]);
 assert.ok(Math.abs(values.reduce((s,v)=>s+v,0)-6.25)<1e-6);
});
test('blanket adds above existing material and cannot overwrite solids or old ash',()=>{
 const old=new Float32Array(layout.count);old[0]=.5;const solid=new Uint8Array(layout.count);solid[1]=1;
 const values=seedPatch(layout,solid,{blanketDepth:.75},old);
 assert.equal(values[0],1);assert.equal(values[3],.25);assert.equal(values[1],0);assert.equal(values[4],.75);
 assert.equal(old[0],.5);assert.equal(values[2],.75);
 assert.throws(()=>seedPatch(layout,solid,{blanketDepth:0}),/Invalid blanket depth/);
 assert.throws(()=>seedPatch(layout,solid,{blanketDepth:Infinity}),/Invalid blanket depth/);
});
test('ground blanket fills the landscape without manufacturing ash on sealed shelves',()=>{
 const solid=new Uint8Array(layout.count);solid[1+3*2]=1;solid[2]=1;
 const values=seedPatch(layout,solid,{blanketDepth:1.25,groundOnly:true});
 assert.deepEqual(Array.from(values),[1,1,0,.25,.25,0,0,0,0,0,0,0,0,0,0,0,0,0]);
});
