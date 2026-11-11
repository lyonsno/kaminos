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

import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {readOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
const admissionStart=source.indexOf('  const startupSceneAdmission = startupSceneData.then');
const admissionEnd=source.indexOf('const sceneWorkerRequested =',admissionStart);
assert.ok(admissionStart>=0&&admissionEnd>admissionStart,'actual startup admission callback must be exercised');
const savedComposition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1',volume_collision:'kiln'}};
function admissionFixture({worker=true,matching=false,rejected=false}={}){
 const data={version:8,label:'Saved flame'},plan={composition:savedComposition},redirects=[],rewrites=[];
 const location=new URL('http://localhost/'+(worker?'?scene_worker=1':'')+'#workspace=workbench&scene=fixture.kaminos.json');
 if(matching)location.searchParams.set('settings_preset',savedComposition.flame.presetId);
 location.replace=url=>redirects.push(url);
 const context={URL,URLSearchParams,sceneWorkerRequested:worker,startupSceneData:Promise.resolve(data),startupSceneHash:new URLSearchParams(location.hash.slice(1)),startupSceneFile:'fixture.kaminos.json',startupSceneRedirect:Symbol(),sceneDocument:{holdRestore(){}},window:{kaminosStartup:{phase(){}}},location,
  planSceneRestore:()=>{if(rejected)throw Error('Rejected saved restore plan');return plan;},setInfo(){},compositionRestoreUrl,readOwnerExperimentAddress,history:{replaceState:(_state,_title,url)=>rewrites.push(url.href)}};
 vm.runInNewContext(source.slice(admissionStart,admissionEnd)+';globalThis.result=startupSceneAdmission;',context);
 return {context,data,plan,redirects,rewrites};
}
test('selected worker keeps actual saved composition and restore plan without legacy recipe navigation',async()=>{
 for(const matching of [false,true]){
  const f=admissionFixture({matching});const result=await f.context.result;
  assert.equal(f.redirects.length,0,'selected worker cannot leave for the legacy recipe wrapper');assert.equal(f.rewrites.length,0,'actual worker plan is not substituted by rewritten page route state');
  assert.equal(result.data,f.data);assert.equal(result.plan,f.plan);assert.equal(result.ui,undefined,'retaining admission is not applying the scene');
 }
});
test('ordinary page still redirects to its exact immutable saved recipe',async()=>{
 const f=admissionFixture({worker:false});const result=await f.context.result;
 assert.equal(result,f.context.startupSceneRedirect);assert.equal(f.redirects.length,1);
 const target=new URL(f.redirects[0]);assert.equal(target.pathname,'/volume-settings-preset.html');assert.equal(target.searchParams.get('preset'),savedComposition.flame.presetId);
 assert.equal(new URLSearchParams(target.hash.slice(1)).get('scene'),'fixture.kaminos.json');
});
test('selected worker still rejects an inadmissible saved plan before forwarding data',async()=>{
 const f=admissionFixture({rejected:true});await assert.rejects(f.context.result,/Rejected saved restore plan/);
 assert.deepEqual(f.redirects,[]);assert.deepEqual(f.rewrites,[]);
});
