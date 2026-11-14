// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Group} from '../lib/three.core.js';
import {createParticlePacketLighting} from '../particle-packet-lighting.mjs';

test('an unchanged held observation becomes available again after a transient material miss',async()=>{
 globalThis.GPUBufferUsage??={STORAGE:128,COPY_DST:8};
 let available=true,solves=0,installed=null;const scene=new Group();
 const device={createBuffer:({size})=>({size,destroy(){}}),queue:{writeBuffer(){},onSubmittedWorkDone:async()=>{}}};
 const frame={identity:{epoch:2,step:8,frame:9,materialStamp:'same-medium'},domain:{worldFromFine:{scale:1,translate:[0,0,0]}}};
 const owner={submitOpticalParticleMaterial(encode){if(!available)return {available:false,reason:'source transition'};encode({},frame,device);return {available:true,identity:frame.identity};},setOpticalParticleIncident:field=>{installed=field;}};
 const controller=createParticlePacketLighting({runtime:()=>owner,scene:()=>scene,createNetwork:()=>({prepare:async()=>{},encode:()=>{solves++;return {identity:frame.identity,receipt:{identity:frame.identity}};},dispose(){}})});
 controller.configure({enabled:true});controller.tick();await new Promise(setImmediate);controller.tick();
 assert.equal(controller.read().receipt.available,true);assert.ok(installed);assert.equal(solves,1);
 available=false;controller.tick();assert.equal(controller.read().receipt.available,false);
 available=true;frame.identity.frame++;controller.tick();
 assert.equal(controller.read().receipt.available,true,'the same still-valid observation must recover its availability');
 assert.equal(solves,1,'presentation frames do not retrace unchanged held material');
 frame.identity.materialStamp='edited-medium';controller.tick();assert.equal(solves,2,'same-step coefficient changes require a fresh solve');
 controller.dispose();assert.equal(installed,null);
});
