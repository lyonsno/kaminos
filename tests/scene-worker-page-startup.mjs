// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const bootStart=source.indexOf('let startupSceneAdmitted = false;');
const bootEnd=source.indexOf('settleStartupVeil(',bootStart);
const continuation=source.indexOf('sceneInitialization.then(async () => {',bootEnd);
const catchStart=source.indexOf('}).catch(err => {',continuation);
const catchEnd=source.indexOf('\n});',catchStart);
assert.ok(bootStart>=0&&bootEnd>bootStart&&catchEnd>catchStart);
test('the existing worker page startup selects the worker owner instead of page GPU initialization',async()=>{
 for(const worker of [false,true]){
  const calls=[],admission={data:{label:'authored input'},plan:null};
  const context={sceneWorkerRequested:worker,startupSceneAdmission:Promise.resolve(admission),startupSceneRedirect:Symbol(),
   initScene:()=>{calls.push('page-gpu');return 'legacy';},initSceneWorkerPage:value=>{assert.equal(value,admission);calls.push('worker');return 'worker';}};
  vm.runInNewContext(source.slice(bootStart,bootEnd)+';globalThis.result=sceneInitialization;',context);
  assert.equal(await context.result,worker?'worker':'legacy');
  assert.deepEqual(calls,[worker?'worker':'page-gpu']);
 }
});
test('the worker owner bypasses the old successful GPU and authoring continuation',async()=>{
 const calls=[];const body=source.slice(continuation+'sceneInitialization.then(async () => {'.length,catchStart);
 const context={sceneWorkerRequested:true,startupSceneAdmitted:true,rejectWorkbenchViewerReady(){},window:{__kaminosDeferredGrInit(){calls.push('legacy-startup');throw Error('legacy continuation reached');}}};
 vm.runInNewContext('globalThis.result=(async()=>{'+body+'})();',context);
 await context.result.catch(()=>{});
 assert.deepEqual(calls,[],'worker initialization must not flow into page-owned GPU/authoring startup');
});
test('worker startup failure cannot silently boot the old independent volume fallback',async()=>{
 const calls=[];const context={sceneWorkerRequested:true,startupSceneAdmitted:true,startupSceneText:'',
  rejectWorkbenchViewerReady(){},console:{error(){}},setInfo(){},
  initEnvButtons:()=>calls.push('environment'),loadDemoButtons:()=>calls.push('demos'),restoreSettings:()=>calls.push('settings'),
  URLSearchParams,location:{search:'?scene_worker=1',hash:''},fireAtBoot:()=>({boot:true}),
  initKaminosVolumeRoute:()=>{calls.push('page-volume');return Promise.resolve();},reportKaminosVolumeRouteInitFailure(){},
  initWorldChambersRoute(){},initKaminosFingerFluidBenchRoute(){},initKaminosFingerJuiceHostRoute(){},initKaminosFingerJuiceTabRoute(){}};
 vm.runInNewContext('globalThis.result=(async err=>{'+source.slice(catchStart+'}).catch(err => {'.length,catchEnd)+'})(Error("worker bundle failed"));',context);
 await context.result;
 assert.deepEqual(calls,[],'worker failure must retain its actual failed route');
});
