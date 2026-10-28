// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createSceneBurning} from '../scene-burning.mjs';
test('changing live appearance retains the resident body, evolved state and playback',async()=>{
 let created=0,disposed=0,steps=0,appearance={profile:'incineration',glow:1},paused=false;
 const entry={id:'wood',object:{},burnable:{enabled:true,material:'wood'}};
 const runtime={debugState:()=>({active:true,simulationPaused:paused}),borrowThermalGpuContext:async()=>({device:{}}),bindGpuThermalConsumer:()=>()=>{}};
 const burning=createSceneBurning({objects:()=>[entry],runtime:()=>runtime,createGas:async()=>({descriptor:{},dispose(){}}),createBody:async()=>{created++;return {setMounted(){},setAppearance:value=>appearance={...appearance,...value},dispose(){disposed++;},read:()=>({steps,appearance})};}});
 await burning.sync();steps=200;
 for(const profile of ['crust','incineration']){burning.setAppearance('wood',{profile,glow:.5});assert.equal(burning.read('wood').state.steps,200);assert.equal(burning.read('wood').state.appearance.profile,profile);assert.equal(created,1);assert.equal(disposed,0);assert.equal(paused,false);}
 await burning.dispose();assert.equal(disposed,1);
});
