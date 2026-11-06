// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
// Execute the actual main startup tail with controlled environment/restore I/O.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createWorkbenchSceneHost,createWorkbenchFrameService} from '../workbench-scene-host.mjs';
import {fireAtBoot} from '../fire-boot.mjs';
import {newSceneDocument,sceneDefaultsFromDocument,sceneDefaultsApplyToLocation,resolveStartupSceneDefaults} from '../user-preferences.mjs';
const source=fs.readFileSync(process.env.KAMINOS_STARTUP_TEST_INDEX||new URL('../index.html',import.meta.url),'utf8');
const a=source.indexOf('// --- Init ---'),b=source.indexOf('</script>',a);assert.ok(a>=0&&b>a);
const tail=source.slice(a,b);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({saved=true,authoring=true,restoreFailure=false,silentFailure=false,defaults=false,agent=false,existing=false,missing=false}={}){
 let releaseVolume,releaseRestore,resolveReady,rejectReady,ownerCount=0,fireStarts=0,session;
 const volume=new Promise(resolve=>releaseVolume=resolve),restore=new Promise(resolve=>releaseRestore=resolve),ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
 const scene=new THREE.Scene(),rows=[],frames=createWorkbenchFrameService(),events=[],documents=[];
 const host=createWorkbenchSceneHost({scene,camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3()},loadAsset(){throw Error('fixture attaches a real Three root');},registerObject(root,metadata){const row={id:'owned',object:root,...metadata};rows.push(row);return row;},findObject:root=>rows.find(r=>r.object===root),removeObject:handle=>{scene.remove(handle.root);rows.splice(rows.findIndex(r=>r.id===handle.id),1);},redraw(){},onFrame:frames.onFrame});
 const c={URLSearchParams,Promise,grInit(){},initScene:()=>Promise.resolve(),settleStartupVeil:(_document,promise)=>promise,document:{body:{classList:{add(){}}},getElementById:()=>({value:'1',dispatchEvent(){}})},window:{location:{search:'?experiment=fixture'}},location:{href:agent?'http://localhost/?defaults=agent&workspace=workbench&experiment=fixture&experiment_inputs=%7B%22roughness%22%3A0.8%7D':'http://localhost/',hash:saved?(authoring?'#authoring=1&scene=saved.json':'#workspace=workbench&scene=saved.json'):'',search:defaults?'':'?experiment=fixture'},console:{error(){}},File:class{constructor(parts){this.text=async()=>parts.join('');}},sceneSaveBlockedByFailedRestore:false,
  startupPreferencesLoaded:Promise.resolve(),startupPreferences:agent?{sceneDefaults:{environment:{name:'studio',exposure:1}},agentSceneDefaults:{environment:{name:'studio',exposure:.4},postprocessing:{sceneGI:{resolutionScale:.1,slices:2,steps:6}}}}:defaults?{sceneDefaults:{}}:null,factorySceneDocument:null,preferencesUI:null,preferencesStartupSettled:false,sceneDefaultsApplied:false,
  environmentDefaults:()=>({exposure:1.1,intensity:.7}),buildSceneData:()=>({schema:'kaminos.scene.v1',version:10,environment:{name:'studio'}}),installUserPreferences:()=>({}),installRelativeNumberDrag(){},userPreferences:{state:()=>({})},sceneDefaultsFromDocument,sceneDefaultsApplyToLocation,resolveStartupSceneDefaults,newSceneDocument,sceneObjects:existing?[{id:'already-here'}]:[],scenePlacementTools:{state:()=>({undoCount:0,active:null})},
  initEnvButtons(){},loadDemoButtons(){},restoreSettings(){return 'studio';},loadEnvironment:()=>Promise.resolve(),kaminosMeshAssetRouteFromSearch:()=>null,kaminosSplatAssetRouteFromSearch:()=>null,kaminosImageAssetRouteFromSearch:()=>null,
  fireAtBoot,initKaminosVolumeRoute:()=>{fireStarts++;return volume;},reportKaminosVolumeRouteInitFailure(){},initKaminosMotionAgencyRoute(){},initWorldChambersRoute(){},initKaminosFingerFluidBenchRoute(){},initKaminosFingerJuiceHostRoute(){},initKaminosFingerJuiceTabRoute(){},setActiveTab(){},compositionStatus(){},setInfo(){},planSceneRestore:()=>({}),fetch:async()=>({ok:!missing,json:async()=>({}),text:async()=>'{"version":8}'}),
  async loadSceneFile(file){if(agent)documents.push(JSON.parse(await file.text()));events.push('restore started');await restore;if(restoreFailure)throw Error('saved restoration rejected');if(silentFailure){events.push('restore refused');return;}for(const row of rows){scene.remove(row.object);row.object.geometry?.dispose();}rows.length=0;c.sceneDocument.authoringChanged();events.push('restore completed');},
  resolveWorkbenchViewerReady(){events.push('viewer ready');resolveReady();},rejectWorkbenchViewerReady(error){events.push('viewer failed');rejectReady(error);},
  async installOwnerWorkbenchEntry(){await ready;ownerCount++;session=host.open();const root=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());await session.attach(root,{owned:true});session.onFrame(()=>{});events.push('owner attached');},
 };
 sceneContext(c);vm.runInContext(tail,c);
 return {c,events,documents,scene,rows,ready,releaseVolume,releaseRestore,ownerCount:()=>ownerCount,fireStarts:()=>fireStarts,frames,dispose:()=>session?.dispose()};
}
test('saved-scene startup admits owner only after actual restoration completes',async t=>{
 const f=fixture();t.after(f.dispose);await flush();assert.equal(f.ownerCount(),0,'owner must wait for saved-scene startup');f.releaseVolume();await flush();assert.equal(f.ownerCount(),0,'owner must wait for delayed restoration');f.releaseRestore();await f.ready;await flush();assert.deepEqual(f.events,['restore started','restore completed','viewer ready','owner attached']);assert.equal(f.rows.length,1);assert.equal(f.rows[0].object.parent,f.scene);assert.equal(f.frames.state().activeSubscriptions,1);
});
test('failed saved restoration rejects dependent scene availability without owner allocation',async t=>{
 const f=fixture({restoreFailure:true});t.after(f.dispose);f.releaseVolume();await flush();f.releaseRestore();await assert.rejects(f.ready,/saved restoration rejected/);await flush();assert.equal(f.ownerCount(),0);assert.equal(f.rows.length,0);assert.equal(f.frames.state().activeSubscriptions,0);assert.equal(f.c.window.kaminosSceneRestoreError,'saved restoration rejected');assert.equal(f.c.window.kaminosWorkbenchExperimentError,undefined,'scene refusal retains its own diagnostic channel');
});
test('ordinary route retains finite environment startup without waiting for volume',async t=>{
 const f=fixture({saved:false});t.after(f.dispose);await f.ready;await flush();assert.equal(f.ownerCount(),1);assert.deepEqual(f.events,['viewer ready','owner attached']);f.releaseVolume();f.releaseRestore();
});

test('Workbench saved-scene address also waits for the actual starting scene',async t=>{const f=fixture({authoring:false});t.after(f.dispose);await flush();assert.equal(f.ownerCount(),0,'Workbench saved scene must finish before owner entry');f.releaseVolume();await flush();assert.equal(f.ownerCount(),0);f.releaseRestore();await f.ready;await flush();assert.deepEqual(f.events,['restore started','restore completed','viewer ready','owner attached']);});
test('handled scene-loader failure cannot masquerade as a completed starting scene',async t=>{const f=fixture({silentFailure:true});t.after(f.dispose);f.releaseVolume();await flush();f.releaseRestore();await assert.rejects(f.ready,/restoration did not complete/);await flush();assert.equal(f.ownerCount(),0);assert.equal(f.rows.length,0);});

test('explicit new-scene defaults settle before a consumer can attach objects',async t=>{const f=fixture({saved:false,defaults:true});t.after(f.dispose);await flush();assert.equal(f.ownerCount(),0);assert.deepEqual(f.events,['restore started']);f.releaseRestore();await f.ready;await flush();assert.deepEqual(f.events,['restore started','restore completed','viewer ready','owner attached']);assert.equal(f.c.sceneDefaultsApplied,true);});

test('missing starting scene does not start fallback fire or admit an owner',async()=>{
 const f=fixture({missing:true});await assert.rejects(f.ready,/Scene unavailable/);await flush();
 assert.equal(f.fireStarts(),0);assert.equal(f.ownerCount(),0);
});


test('an explicit agent Workbench run restores authored defaults before its experiment attaches',async t=>{
 const f=fixture({saved:false,agent:true});t.after(f.dispose);await flush();
 assert.equal(f.ownerCount(),0,'agent settings restoration must precede owner attachment');
 assert.deepEqual(f.events,['restore started']);
 assert.equal(f.documents[0].postprocessing.sceneGI.resolutionScale,.1);
 assert.equal(f.documents[0].environment.exposure,.4);
 f.releaseRestore();await f.ready;await flush();
 assert.deepEqual(f.events,['restore started','restore completed','viewer ready','owner attached']);
 assert.equal(f.c.window.kaminosPreferences.startup().effective,'agent');
 assert.equal(f.c.window.kaminosPreferences.startup().usesDefaults,true);
});


test('agent startup reports when existing scene work prevents profile application',async t=>{
 const f=fixture({saved:false,agent:true,existing:true});t.after(f.dispose);await f.ready;await flush();
 assert.equal(f.documents.length,0);assert.equal(f.c.window.kaminosPreferences.startup().usesDefaults,false);
 assert.equal(f.c.window.kaminosPreferences.startup().effective,null);
 assert.equal(f.c.window.kaminosPreferences.startup().reason,'existing-scene-work');
});
