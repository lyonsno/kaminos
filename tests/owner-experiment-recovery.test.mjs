// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compositionRestoreUrl,forwardCompositionHash} from '../scene-authoring.mjs';
import * as ownerAddress from '../owner-experiment-entry.mjs';
import {fireAtBoot} from '../fire-boot.mjs';
import {createSceneOwnerControls} from '../scene-owner-controls.mjs';
const html=fs.readFileSync(process.env.KAMINOS_RECOVERY_TEST_INDEX||new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('sceneInitialization.then(() => {'),end=html.indexOf('</script>',start);assert.ok(start>=0&&end>start);
const tail=html.slice(start,end);
const entryStart=html.indexOf('async function installOwnerWorkbenchEntry()'),entryEnd=html.indexOf('\n}',entryStart);assert.ok(entryStart>=0&&entryEnd>entryStart);
const entry=html.slice(entryStart,entryEnd+2);
const wrapper=fs.readFileSync(new URL('../volume-settings-preset.html',import.meta.url),'utf8');
const forwardedExpression=wrapper.match(/location.replace\((forwardCompositionHash\(target, location.hash[^;]+)\);/)[1];
const preset='vsp-'+'a'.repeat(64),wrong='vsp-'+'b'.repeat(64);
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:preset,stationary:true},route:{volume_light_field:'1'},lightGainStops:0};
const inputs={size:2,label:'water & flame / Δ',nested:{step:1/240},samples:Array.from({length:1000},(_,i)=>i)};
const inputsText=JSON.stringify(inputs);
const incoming=new URL('http://localhost/index.html?workspace=workbench&experiment=fixture%2Fowner&experiment_inputs='+encodeURIComponent(inputsText)+'&settings_preset='+wrong+'#workspace=workbench&scene=tuned.kaminos.json');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function startup(url,{matching=false}={}){
 let redirects=[],loads=0,admissions=0,owners=0,rejection=null;
 const location={href:url.href,search:url.search,hash:url.hash,origin:url.origin,replace:value=>redirects.push(value)};
 const c={URL,URLSearchParams,Promise,Symbol,File:class{},compositionRestoreUrl,forwardCompositionHash,...ownerAddress,sceneInitialization:Promise.resolve(),document:{body:{classList:{add(){}}}},window:{location},location,console:{error(){}},sceneSaveBlockedByFailedRestore:false,
 initEnvButtons(){},loadDemoButtons(){},restoreSettings(){return 'studio';},loadEnvironment:()=>Promise.resolve(),kaminosMeshAssetRouteFromSearch:()=>null,kaminosSplatAssetRouteFromSearch:()=>null,kaminosImageAssetRouteFromSearch:()=>null,
 fireAtBoot,initKaminosVolumeRoute:()=>Promise.resolve(),reportKaminosVolumeRouteInitFailure(){},initKaminosMotionAgencyRoute(){},initWorldChambersRoute(){},initKaminosFingerFluidBenchRoute(){},initKaminosFingerJuiceHostRoute(){},initKaminosFingerJuiceTabRoute(){},setActiveTab(){},compositionStatus(){},setInfo(){},planSceneRestore:()=>({composition}),fetch:async()=>({ok:true,json:async()=>({})}),
 async loadSceneFile(){loads++;c.sceneSaveBlockedByFailedRestore=false;},resolveWorkbenchViewerReady(){admissions++;},rejectWorkbenchViewerReady(error){rejection=error.message;},async installOwnerWorkbenchEntry(){owners++;},};
 vm.createContext(c);vm.runInContext(tail,c);for(let i=0;i<5;i++)await flush();return {redirects,loads,admissions,owners,rejection,blocked:c.sceneSaveBlockedByFailedRestore};
}
function destination(recovery){const url=new URL(recovery),target='http://localhost/index.html?settings_preset='+preset;return new URL(vm.runInNewContext(forwardedExpression,{forwardCompositionHash,target,location:{hash:url.hash,search:url.search}}));}
async function openActualEntry(url){
 let opened=null,onChange;
 const location={href:url.href,search:url.search,hash:url.hash};
 const c={URL,URLSearchParams,JSON,...ownerAddress,createSceneOwnerControls,sceneOwnerControls:null,selectedPlacementEntry:()=>null,ownerExperimentEntry:null,document:{getElementById:()=>({})},installRelativeNumberDrag(){},workbenchViewerReady:Promise.resolve(),workbenchSceneHost:{open(){}},setActiveTab(){},refreshWorkbenchAssetPresentation(){},location,history:{state:null,replaceState(_state,_title,value){const u=new URL(String(value));Object.assign(location,{href:u.href,search:u.search,hash:u.hash});}},window:{},
 setActiveSceneObject(){},async installOwnerExperimentEntry(options){onChange=options.onChange;return {async open(id,inputs){opened={id,inputs};}};}};
 vm.createContext(c);vm.runInContext(entry,c);await c.installOwnerWorkbenchEntry();return {opened,close:()=>onChange({id:null,inputs:null}),location};
}
test('mismatched and absent presets retain full owner setup through actual wrapper and destination installer',async()=>{
 for(const missing of [false,true]){const url=new URL(incoming);if(missing)url.searchParams.delete('settings_preset');const result=await startup(url);assert.equal(result.redirects.length,1);
  const recovery=new URL(result.redirects[0]);assert.deepEqual([...recovery.searchParams.keys()],['preset'],'frontend owner inputs stay outside canonical recipe parameters');
  const target=destination(recovery);const installed=await openActualEntry(target);assert.deepEqual(installed.opened,{id:'fixture/owner',inputs});assert.equal(target.hash.includes('scene='),true);
 }
});
test('departing recipe redirect cannot admit a viewer or allocate an owner on an unrestored scene',async()=>{
 const result=await startup(incoming);assert.equal(result.loads,0);assert.equal(result.admissions,0);assert.equal(result.owners,0);assert.equal(result.blocked,true);assert.match(result.rejection,/recover|navigat|redirect/i);
});
test('correct destination restores the scene before admitting the retained owner',async()=>{
 const recovery=await startup(incoming),target=destination(recovery.redirects[0]);const result=await startup(target);assert.equal(result.loads,1);assert.equal(result.admissions,1);assert.equal(result.owners,1);assert.equal(result.blocked,false);assert.deepEqual((await openActualEntry(target)).opened,{id:'fixture/owner',inputs});
});
test('closing an owner opened from recovery clears both address channels',async()=>{
 const target=destination((await startup(incoming)).redirects[0]),installed=await openActualEntry(target);installed.close();const closed=new URL(installed.location.href);
 for(const params of [closed.searchParams,new URLSearchParams(closed.hash.slice(1))])for(const key of ['experiment','experiment_inputs'])assert.equal(params.has(key),false);
 assert.equal(new URLSearchParams(closed.hash.slice(1)).get('scene'),'tuned.kaminos.json');assert.equal((await openActualEntry(closed)).opened,null);
});
test('ordinary query inputs override stale recovered inputs as one coherent pair',async()=>{
 const url=new URL(incoming);url.hash='experiment=stale&experiment_inputs='+encodeURIComponent('{"stale":true}');assert.deepEqual((await openActualEntry(url)).opened,{id:'fixture/owner',inputs});
});
