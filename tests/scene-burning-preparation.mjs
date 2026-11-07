// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneBurning} from '../scene-burning.mjs';

test('explicit cold preparation retains thermal resources without activation or simulation',async()=>{
 const entry={id:'prompt',object:{},burnable:{enabled:true}},events=[];let consumer,active=false,steps=0;
 const host={debugState:()=>({active}),borrowThermalGpuContext:async()=>{events.push('context');return {device:'shared'};},bindGpuThermalConsumer(value){consumer=value;events.push('bind');return()=>{consumer=null;};},setActive:()=>assert.fail('preparation activated the field')};
 const body={setMounted(){},setSettings(){},materialMask:()=>entry.id,encodeGasSource(){},encode(){steps++;},read:()=>({steps}),dispose(){events.push('dispose-body');}};
 const burning=createSceneBurning({objects:()=>[entry],runtime:()=>host,createGas:async()=>({descriptor:{device:'shared'},begin(){},resolve(){},read:()=>({}),dispose(){events.push('dispose-gas');}}),createBody:async()=>{events.push('body');return body;},yieldPreparation:async()=>{events.push('yield');}});
 await burning.sync();assert.deepEqual(events,[],'ordinary Burnable sync stays cold');
 assert.equal(typeof burning.prepare,'function','the consumer needs explicit preparation before activation');
 await Promise.all([burning.prepare(),burning.prepare()]);
 assert.equal(burning.read('prompt').status,'resident');assert.equal(steps,0);assert.equal(events.filter(x=>x==='body').length,1);assert.ok(events.includes('yield'));
 const retained=consumer;active=true;await burning.sync();assert.equal(consumer,retained);consumer.encode({},{});assert.equal(steps,1);
 active=false;await burning.sync();await burning.prepare();assert.equal(consumer,retained);assert.equal(events.filter(x=>x==='body').length,1);assert.equal(steps,1);
 await burning.dispose();assert.equal(consumer,null);assert.equal(events.filter(x=>x==='dispose-body').length,1);
});

test('removal during explicit cold preparation disposes the late body',async()=>{
 let objects=[{id:'p',object:{},burnable:{enabled:true}}],release,disposed=0;
 const host={debugState:()=>({active:false}),borrowThermalGpuContext:async()=>({device:'shared'}),bindGpuThermalConsumer:()=>()=>{}};
 const burning=createSceneBurning({objects:()=>objects,runtime:()=>host,createGas:async()=>({descriptor:{},dispose(){}}),createBody:()=>new Promise(resolve=>{release=()=>resolve({dispose(){disposed++;}});})});
 assert.equal(typeof burning.prepare,'function');const pending=burning.prepare();await new Promise(setImmediate);objects=[];release();await pending;assert.equal(disposed,1);await burning.dispose();
});
