// kaminos-test: node
// Execute the actual main startup tail with controlled environment/restore I/O.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createWorkbenchSceneHost,createWorkbenchFrameService} from '../workbench-scene-host.mjs';
const source=fs.readFileSync(process.env.KAMINOS_STARTUP_TEST_INDEX||new URL('../index.html',import.meta.url),'utf8');
const a=source.indexOf('sceneInitialization.then(() => {'),b=source.indexOf('</script>',a);assert.ok(a>=0&&b>a);
const tail=source.slice(a,b);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({saved=true,restoreFailure=false}={}){
 let releaseVolume,releaseRestore,resolveReady,rejectReady,ownerCount=0,session;
 const volume=new Promise(resolve=>releaseVolume=resolve),restore=new Promise(resolve=>releaseRestore=resolve),ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
 const scene=new THREE.Scene(),rows=[],frames=createWorkbenchFrameService(),events=[];
 const host=createWorkbenchSceneHost({scene,camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3()},loadAsset(){throw Error('fixture attaches a real Three root');},registerObject(root,metadata){const row={id:'owned',object:root,...metadata};rows.push(row);return row;},findObject:root=>rows.find(r=>r.object===root),removeObject:handle=>{scene.remove(handle.root);rows.splice(rows.findIndex(r=>r.id===handle.id),1);},redraw(){},onFrame:frames.onFrame});
 const c={URLSearchParams,Promise,sceneInitialization:Promise.resolve(),document:{body:{classList:{add(){}}}},window:{location:{search:'?experiment=fixture'}},location:{hash:saved?'#authoring=1&scene=saved.json':'',search:'?experiment=fixture'},console:{error(){}},File:class{},sceneSaveBlockedByFailedRestore:false,
  initEnvButtons(){},loadDemoButtons(){},restoreSettings(){return 'studio';},loadEnvironment:()=>Promise.resolve(),kaminosMeshAssetRouteFromSearch:()=>null,kaminosSplatAssetRouteFromSearch:()=>null,kaminosImageAssetRouteFromSearch:()=>null,
  initKaminosVolumeRoute:()=>volume,reportKaminosVolumeRouteInitFailure(){},initKaminosMotionAgencyRoute(){},initWorldChambersRoute(){},initKaminosFingerFluidBenchRoute(){},initKaminosFingerJuiceHostRoute(){},initKaminosFingerJuiceTabRoute(){},setActiveTab(){},compositionStatus(){},setInfo(){},planSceneRestore:()=>({}),fetch:async()=>({ok:true,json:async()=>({})}),
  async loadSceneFile(){events.push('restore started');await restore;if(restoreFailure)throw Error('saved restoration rejected');for(const row of rows){scene.remove(row.object);row.object.geometry?.dispose();}rows.length=0;c.sceneSaveBlockedByFailedRestore=false;events.push('restore completed');},
  resolveWorkbenchViewerReady(){events.push('viewer ready');resolveReady();},rejectWorkbenchViewerReady(error){events.push('viewer failed');rejectReady(error);},
  async installOwnerWorkbenchEntry(){await ready;ownerCount++;session=host.open();const root=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());await session.attach(root,{owned:true});session.onFrame(()=>{});events.push('owner attached');},
 };
 vm.createContext(c);vm.runInContext(tail,c);
 return {c,events,scene,rows,ready,releaseVolume,releaseRestore,ownerCount:()=>ownerCount,frames,dispose:()=>session?.dispose()};
}
test('saved-scene startup admits owner only after actual restoration completes',async t=>{
 const f=fixture();t.after(f.dispose);await flush();assert.equal(f.ownerCount(),0,'owner must wait for saved-scene startup');f.releaseVolume();await flush();assert.equal(f.ownerCount(),0,'owner must wait for delayed restoration');f.releaseRestore();await f.ready;await flush();assert.deepEqual(f.events,['restore started','restore completed','viewer ready','owner attached']);assert.equal(f.rows.length,1);assert.equal(f.rows[0].object.parent,f.scene);assert.equal(f.frames.state().activeSubscriptions,1);
});
test('failed saved restoration rejects dependent scene availability without owner allocation',async t=>{
 const f=fixture({restoreFailure:true});t.after(f.dispose);f.releaseVolume();await flush();f.releaseRestore();await assert.rejects(f.ready,/saved restoration rejected/);await flush();assert.equal(f.ownerCount(),0);assert.equal(f.rows.length,0);assert.equal(f.frames.state().activeSubscriptions,0);assert.equal(f.c.window.kaminosWorkbenchExperimentError,'saved restoration rejected');
});
test('ordinary route retains finite environment startup without waiting for volume',async t=>{
 const f=fixture({saved:false});t.after(f.dispose);await f.ready;await flush();assert.equal(f.ownerCount(),1);assert.deepEqual(f.events,['viewer ready','owner attached']);f.releaseVolume();f.releaseRestore();
});
