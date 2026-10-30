// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneBurning} from '../scene-burning.mjs';
let bodies=0,steps=0,consumer;
const entry={id:'text',object:{},burnable:{enabled:true}};
const host={debugState:()=>({active:false}),borrowThermalGpuContext:async()=>({device:'same'}),bindGpuThermalConsumer:c=>{consumer=c;return()=>{};}};
const burning=createSceneBurning({objects:()=>[entry],runtime:()=>host,createGas:async()=>({descriptor:{},dispose(){},read(){}}),createBody:async()=>{bodies++;return {setMounted(){},encode(){steps++;},read:()=>({steps}),dispose(){}};}});
await burning.sync();assert.equal(bodies,0,'ordinary cold reconciliation must stay cold');
assert.equal(typeof burning.prepare,'function','explicit preparation may allocate without starting simulation');
await burning.prepare();assert.equal(bodies,1);assert.equal(steps,0);assert.equal(burning.read('text').status,'resident');await burning.prepare();assert.equal(bodies,1);assert.equal(steps,0);await burning.dispose();
