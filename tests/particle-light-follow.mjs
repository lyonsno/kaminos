// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLightSliceReceiverFollow,followReceiverRead} from '../particle-light-follow.mjs';
const world=[4,8,12];
test('a tracked receiver preserves its offset and never silently follows a recycled carrier',()=>{
 const first=followReceiverRead({receiver:world},{epoch:3,slot:0,birth:14,point:[3,7,10],step:11});
 assert.deepEqual(first.offset,[1,1,2]);assert.deepEqual(first.position,world);
 const next=followReceiverRead(first,{epoch:3,slot:0,birth:14,point:[4,9,13],step:13});
 assert.deepEqual(next.position,[5,10,15]);
 assert.equal(followReceiverRead(next,{epoch:3,slot:0,birth:15,point:[4,9,13],step:14}).state,'lost');
 assert.equal(followReceiverRead(next,{epoch:4,slot:0,birth:14,point:[4,9,13],step:14}).state,'lost');
});

test('terminal material loss ends a track, while a transient material gap leaves it seeking',()=>{
 let terminal=false;
 const owner={submitOpticalParticleMaterial:()=>({available:false,terminal,reason:terminal?'Native particle material is inactive':'Awaiting current material'})};
 const f=createLightSliceReceiverFollow({runtime:()=>owner});
 f.start(world,1,{emissive:true});f.tick();assert.equal(f.read().state,'seeking');
 terminal=true;f.tick();assert.deepEqual(f.read(),{state:'lost',reason:'Native particle material is inactive'});
});
