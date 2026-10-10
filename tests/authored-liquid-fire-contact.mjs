import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthoredLiquidFireContactBridge} from '../authored-liquid-fire-contact.mjs';
const make=()=>{
 const device={queue:{}};
 const descriptor={device,queue:device.queue,headerBuffer:{},recordsBuffer:{},allocationGeneration:1,epoch:1,sourceFrameHash:7,sourceFrameId:'solver-frame'};
 let frame={schema:'kaminos.authored-liquid-contact-frame.v1',hostFrameId:'water-1',sceneGeneration:1,sourceGeneration:1,sourceIds:['water-a'],producerTick:1,descriptor};
 const host={contactFrame:()=>frame};
 const calls=[];const receiver={setLiquidFireContactDescriptor:d=>{calls.push(['bind',d]);return {sameDevice:true};},clearLiquidFireContactDescriptor:()=>calls.push(['clear'])};
 return {device,descriptor,host,receiver,calls,update:f=>{frame=f},frame};
};
test('bind live host once; retain tick and authored identities without relabeling GPU source',()=>{
 const f=make(),b=createAuthoredLiquidFireContactBridge();b.sync(f.host,f.receiver);b.sync(f.host,f.receiver);
 assert.equal(f.calls.length,1);assert.deepEqual(b.state().sourceIds,['water-a']);assert.equal(b.state().producerTick,1);assert.equal(f.calls[0][1].sourceFrameId,'solver-frame');
});
test('retire before destruction; stale owner cannot clear replacement',()=>{
 const f=make(),b=createAuthoredLiquidFireContactBridge();b.sync(f.host,f.receiver);const other={contactFrame:f.host.contactFrame};b.sync(other,f.receiver);b.retire(f.host);assert.equal(b.state().status,'bound');b.retire(other);assert.equal(f.calls.at(-1)[0],'clear');assert.equal(b.state().status,'unbound');
});
test('missing/paused host releases binding; resumed new frame rebinds',()=>{
 const f=make(),b=createAuthoredLiquidFireContactBridge();b.sync(f.host,f.receiver);f.update(null);b.sync(f.host,f.receiver);assert.equal(f.calls.at(-1)[0],'clear');f.update(f.frame);b.sync(f.host,f.receiver);assert.equal(f.calls.at(-1)[0],'bind');
});
test('reject invalid lifetime and non-shared queue; clear previous binding on rejection',()=>{
 for(const patch of [{producerTick:0},{sourceIds:null},{hostFrameId:''},{sceneGeneration:-1},{descriptor:null}]){
  const f=make(),b=createAuthoredLiquidFireContactBridge();b.sync(f.host,f.receiver);f.update({...f.frame,...patch});assert.throws(()=>b.sync(f.host,f.receiver));assert.equal(f.calls.at(-1)[0],'clear');
 }
 const f=make(),b=createAuthoredLiquidFireContactBridge();f.descriptor.queue={};assert.throws(()=>b.sync(f.host,f.receiver));
});
test('receiver device refusal propagates and clears rather than claims binding',()=>{
 const f=make(),b=createAuthoredLiquidFireContactBridge();f.receiver.setLiquidFireContactDescriptor=()=>{throw Error('cross-device')};assert.throws(()=>b.sync(f.host,f.receiver),/cross-device/);assert.notEqual(b.state().status,'bound');
});
