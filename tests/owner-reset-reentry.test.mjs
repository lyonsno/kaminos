import fs from 'node:fs';import assert from 'node:assert/strict';import {createFixedStepPlayback} from '../finger-fluid-box-clock.mjs';
const s=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fn(name){const start=s.indexOf('function '+name+'(');if(start<0)return '';let begin=s.indexOf('{',start),depth=1,end=begin+1;for(;depth;end++){if(s[end]==='{')depth++;if(s[end]==='}')depth--;}return s.slice(start,end);}
for(const paused of [false,true])for(const reverse of [false,true]){
 const pending=[],clock=createFixedStepPlayback({dt:1/240,rate:2});clock.advance(1000);
 const env={fingerFluidResetPolicy:null,fingerFluidBenchSimulationPaused:paused,ownerFluidPlayback:clock,investigationOperations:{active:false},fingerFluidCompositionCameraState:()=>({}),window:{_kaminosDirty(){}},fingerFluidPressureCockpit:null,syncFingerFluidCompositionCamera(){},pending};
 const helper=fn('completeFingerFluidPlaybackInitialization');
 const api=new Function('env',`with(env){let fingerFluidBenchStartGeneration=0,fingerFluidBenchRunning=true,fingerFluidBenchSolver={available:true,destroy(){}},fingerFluidBenchSolverPromise=null,fingerFluidBenchConfig={},fingerFluidBenchCamera=null;${helper};function stopFingerFluidBench(){fingerFluidBenchStartGeneration++;fingerFluidBenchRunning=false;}async function startFingerFluidBench(){const generation=++fingerFluidBenchStartGeneration;await new Promise(r=>pending.push(r));if(generation!==fingerFluidBenchStartGeneration)return;fingerFluidBenchRunning=true;fingerFluidBenchSolver={available:true};${helper?'completeFingerFluidPlaybackInitialization();':''}}async ${fn('resetFingerFluidPressureCockpitWater')};return {reset:resetFingerFluidPressureCockpitWater,start:startFingerFluidBench,stop:stopFingerFluidBench};}`)(env);
 const a=api.reset();api.stop();const b=api.start();if(reverse){pending[1]();await b;pending[0]();await a;}else{pending[0]();await a;pending[1]();await b;}
 assert.equal(env.fingerFluidBenchSimulationPaused,paused,'Cancelled reset and surviving ordinary re-entry preserve chosen policy');assert.equal(env.fingerFluidResetPolicy,null,'Current startup consumes pending initialization policy');assert.equal(clock.advance(5000).steps,0);assert.equal(clock.advance(5100).steps,48);
}
console.log('Actual reset cancellation/re-entry restores policy in either completion order');
