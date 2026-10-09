import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fn(name){let start=source.indexOf('function '+name+'(');if(source.slice(start-6,start)==='async ')start-=6;let open=source.indexOf('{',start),depth=1,end=open+1;for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
function harness(ready,{authored=false}={}){
 const env={fluidViewportReady:ready,localLiquidHost:authored?{}:null,fingerFluidBenchSolverPromise:Promise.resolve({}),fingerFluidBenchSolver:{},fingerFluidBenchConfig:{effectiveTruthScene:'multi_regime_playground'},scene:{},camera:{},renderer:{backend:{device:{}}},renderPipeline:{},groundPlane:null,FINGER_FLUID_BENCH_VIEWPORT_PIPELINE:'test',createFluidBenchScene:()=>({group:{}}),createFluidViewportHost:()=>({}),syncFingerFluidCompositionCamera(){},activateFingerFluidPyroComposition:async()=>{},document:{getElementById:()=>({dataset:{}})},fingerFluidUsesSharedViewport:()=>true,createFingerFluidBenchState:x=>x,updateFingerFluidBenchReadout(){},setInfo(){},window:{_kaminosDirty(){}},cancelAnimationFrame(){}};
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

function resetHarness(){
 const pending=[],writes=[];let savedCamera=1;
 const env={fingerFluidCompositionCameraState:()=>savedCamera,window:{_kaminosDirty(){}},cancelAnimationFrame(){},syncFingerFluidCompositionCamera(){writes.push(env.readCamera());},fingerFluidPressureCockpit:{update(){}},pending};
 const h=new Function('env',`with(env){let fingerFluidBenchStartGeneration=0,fingerFluidBenchRunning=false,fingerFluidBenchViewport=null,fingerFluidBenchScene=null,fingerFluidBenchAnimationFrame=null,fingerFluidBenchSolver=null,fingerFluidBenchSolverPromise=null,fingerFluidBenchConfig=null,fingerFluidBenchCamera=null;
 async function startFingerFluidBench(){const generation=++fingerFluidBenchStartGeneration;fingerFluidBenchRunning=true;await new Promise(resolve=>pending.push(resolve));if(generation!==fingerFluidBenchStartGeneration)return;}
 ${fn('stopFingerFluidBench')};${fn('resetFingerFluidPressureCockpitWater')};
 return {reset:resetFingerFluidPressureCockpitWater,start:startFingerFluidBench,stop:stopFingerFluidBench,camera:()=>fingerFluidBenchCamera};}`)(env);
 env.readCamera=h.camera;return {...h,pending,writes,saveCamera:value=>{savedCamera=value;}};
}
test('a superseded reset cannot restore its camera into a newer reset',async()=>{
 const h=resetHarness();const a=h.reset();h.saveCamera(2);const b=h.reset();h.pending[0]();await a;assert.deepEqual(h.writes,[]);h.pending[1]();await b;assert.deepEqual(h.writes,[2]);
});
test('a reset superseded by tab exit and re-entry cannot restore its camera',async()=>{
 const h=resetHarness();const reset=h.reset();h.stop();const reentry=h.start();h.pending[0]();await reset;assert.deepEqual(h.writes,[]);h.pending[1]();await reentry;assert.deepEqual(h.writes,[]);
});
test('an owned single reset retains the saved camera',async()=>{
 const h=resetHarness();h.saveCamera(3);const reset=h.reset();h.pending[0]();await reset;assert.deepEqual(h.writes,[3]);
});
