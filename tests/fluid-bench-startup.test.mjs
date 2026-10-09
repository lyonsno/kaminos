import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fn(name){let start=source.indexOf('function '+name+'(');if(source.slice(start-6,start)==='async ')start-=6;let open=source.indexOf('{',start),depth=1,end=open+1;for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
function harness(ready,{authored=false}={}){
 const env={fluidViewportReady:ready,localLiquidHost:authored?{}:null,fingerFluidBenchSolverPromise:Promise.resolve({}),fingerFluidBenchSolver:{},fingerFluidBenchConfig:{effectiveTruthScene:'multi_regime_playground'},scene:{},camera:{},renderer:{backend:{device:{}}},renderPipeline:{},groundPlane:null,FINGER_FLUID_BENCH_VIEWPORT_PIPELINE:'test',createFluidBenchScene:()=>({group:{}}),createFluidViewportHost:()=>({}),syncFingerFluidCompositionCamera(){},activateFingerFluidPyroComposition:async()=>{},document:{getElementById:()=>({dataset:{}})},fingerFluidUsesSharedViewport:()=>true,createFingerFluidBenchState:x=>x,updateFingerFluidBenchReadout(){},setInfo(){},markDirty(){},cancelAnimationFrame(){}};
 return new Function('env',`with(env){let fingerFluidBenchStartGeneration=0,fingerFluidBenchRunning=false,fingerFluidBenchViewport=null,fingerFluidBenchScene=null,fingerFluidBenchAnimationFrame=null,fingerFluidBenchState={};${fn('startFingerFluidBench')};${fn('stopFingerFluidBench')};return {start:startFingerFluidBench,stop:stopFingerFluidBench,state:()=>({running:fingerFluidBenchRunning,state:fingerFluidBenchState})}}`)(env);
}
test('leaving before shared scene initialization completes cancels the pending startup',async()=>{
 let release;const h=harness(new Promise(r=>release=r));const pending=h.start();h.stop();release();await pending;assert.equal(h.state().running,false);
});
test('authored-water conflict and scene initialization failures reach the visible error state',async()=>{
 const rejected=Promise.reject(Error('initialization failed'));rejected.catch(()=>{});
 for(const [ready,options,message] of [[Promise.resolve(),{authored:true},/authored water/],[rejected,{},/initialization failed/]]){
  const h=harness(ready,options);await h.start();assert.equal(h.state().running,false);assert.equal(h.state().state.status,'error');assert.match(h.state().state.runtime.reason,message);
 }
});
