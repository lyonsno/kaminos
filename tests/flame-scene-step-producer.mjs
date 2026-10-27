// kaminos-test: node
// Invocation evidence from the actual native method; GPU conformance is separate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFlameSceneClock} from '../flame-scene-clock.mjs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8'),start=source.indexOf('    borrowSceneClock() {'),end=source.indexOf('    setSimulationPaused(paused)',start),method=source.slice(start,end).trim().replace(/,$/,'');
assert.ok(start>=0&&end>start,'Native fluid owner exposes its scene-clock loan');
for(const initiallyBuilt of [false,true]){
 const state={active:true,simStepCount:20},atlas={built:initiallyBuilt,step:initiallyBuilt?10:null},calls=[];
 const values={createFlameSceneClock,state,simulationPaused:false,sceneClockLease:null,controlsSnapshot:{},normalizeLookFreeze:()=>0,lookFreezeCanPin:()=>false,resolveTimeStepConfig:()=>({effective:{dtScale:1}}),device:{createCommandEncoder:()=>({finish:()=>({})}),queue:{submit(){}}},updateUniforms(){},encodeSim(){state.simStepCount++;calls.push('fluid');},encodeFireIrradianceLightField(){atlas.built=true;atlas.step=state.simStepCount;calls.push('light');},encodeLiquidFireContactTransfer(){},encodeSelectiveHeadLiveFields(){}};
 const borrow=Function(...Object.keys(values),'return ({'+method+'}).borrowSceneClock;')(...Object.values(values)),loan=borrow();
 loan.advance({seconds:.1});assert.equal(state.simStepCount,26);assert.equal(atlas.step,26,'Held ordinary fluid steps must produce the corresponding light atlas');assert.equal(atlas.built,true);assert.equal(calls.filter(x=>x==='light').length,6);loan.dispose();
}
console.log('The actual native held-step method refreshes both absent and stale light fields through the existing producer');
