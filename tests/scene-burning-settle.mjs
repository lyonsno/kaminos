// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import {createSceneBurning} from '../scene-burning.mjs';
test('settle includes a new object registered while the prior material allocation is pending',async()=>{
 let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r),objects=[{id:'first',object:{},burnable:{enabled:true}}];
 const runtime={debugState:()=>({active:true}),borrowThermalGpuContext:async()=>({device:{}}),bindGpuThermalConsumer:()=>()=>{}};
 const burning=createSceneBurning({objects:()=>objects.slice(),runtime:()=>runtime,createGas:async()=>({descriptor:{},dispose(){}}),createBody:async(entry)=>{if(entry.id==='first'){started();await gate;}return {setMounted(){},setAppearance(){},read:()=>({}),dispose(){}};}});
 const prior=burning.sync();await began;objects.push({id:'second',object:{},burnable:{enabled:true}});const settled=burning.sync();release();await settled;await prior;assert.equal(burning.read('second').status,'resident','settle must cover the registration that requested it');await burning.dispose();
});
