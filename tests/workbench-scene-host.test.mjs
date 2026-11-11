// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const unavailable=()=>{throw Error('Shared scene host adapter is unavailable on baseline');};
const {createWorkbenchFrameService=unavailable,createWorkbenchSceneHost=unavailable,disposeOwnedSceneTree=unavailable}=await import('../workbench-scene-host.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith('/workbench-scene-host.mjs'))return {};
 throw error;
});
function harness({realControls=false}={}){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,100);
 camera.position.set(0,1,5);
 const controls=realControls?new OrbitControls(camera,null):{target:new THREE.Vector3(),enableDamping:true,update(){camera.lookAt(this.target);}};
 const rows=new Map(),loads=[],removed=[];let id=0;
 const register=(root,metadata)=>{const row={...metadata,id:'mesh-'+(++id),object:root};rows.set(row.id,row);return row;};
 const frameService=createWorkbenchFrameService({onError(){}});
 const host=createWorkbenchSceneHost({scene,camera,controls,
  loadAsset:async(url,options)=>{loads.push({url,options});const root=new THREE.Group();scene.add(root);const row=register(root,{source:url});return {id:row.id,root,clips:[],source:url};},
  registerObject:register,findObject:root=>[...rows.values()].find(row=>row.object===root),
  removeObject:handle=>{const row=rows.get(handle.id);if(row?.object!==handle.root)return false;rows.delete(handle.id);scene.remove(handle.root);removed.push(handle.id);return true;},
  redraw(){},onFrame:frameService.onFrame,
 });
 return {host,scene,camera,controls,rows,loads,removed,register,frameService};
}
test('host frame clock uses seconds, excludes unsubscribe time and isolates a failed producer',()=>{
 const failures=[],frames=[],service=createWorkbenchFrameService({onError:error=>failures.push(error.message)});
 const cancel=service.onFrame(frame=>frames.push(frame));service.onFrame(()=>{throw Error('domain failure');});
 service.tick(1000);service.tick(1025);assert.equal(frames[0].deltaSeconds,0);assert.equal(frames[1].deltaSeconds,.025);
 assert.deepEqual(failures,['domain failure']);cancel();service.tick(5000);
 service.onFrame(frame=>frames.push(frame));service.tick(6000);assert.equal(frames.at(-1).deltaSeconds,0);
});
test('actual scene host loads native coordinates and releases only its owned registration',async()=>{
 const h=harness(),session=h.host.open();const root=new THREE.Group();h.scene.add(root);const borrowed=h.register(root,{source:'existing.glb'});
 const existing=await session.attach(root,{owned:false});assert.equal(existing.id,borrowed.id);
 const asset=await session.loadAsset('/retained/body.glb');assert.equal(asset.owned,true);
 assert.equal(h.loads[0].options.normalize,false);assert.equal(h.loads[0].options.arrival,null);
 await session.dispose();assert.equal(h.scene.children.includes(root),true);assert.equal(h.removed.length,1);
});
test('owned attachment cannot acquire an unrelated existing registration or parent',async()=>{
 const h=harness(),session=h.host.open(),root=new THREE.Group();h.scene.add(root);h.register(root,{source:'existing.glb'});
 await assert.rejects(session.attach(root,{owned:true}),/already|parent/);
 assert.equal(h.scene.children.includes(root),true);
});
test('shared camera rejects an invalid view before mutation and round trips the applied view',()=>{
 const h=harness(),session=h.host.open(),before=session.readView();
 assert.throws(()=>session.setView({...before,position:[0,NaN,1]}),/view|finite/);
 assert.deepEqual(session.readView(),before);
 const view={...before,position:[2,3,4],target:[0,.2,0],fov:55,zoom:1.2};
 assert.deepEqual(session.setView(view),view);
 h.camera.up.set(-0.56,0.82,-0.02).normalize();
 const upright=session.setView({position:[3.8,2.4,4.8],target:[0,0.65,0]});
 assert.deepEqual(upright.up,[0,1,0],'setView without explicit up must reset tilted orbit camera.up to upright');
 const right=new THREE.Vector3(1,0,0).applyQuaternion(h.camera.quaternion);
 assert.ok(Math.abs(right.y)<1e-9,`setView must keep horizon level, got right.y=${right.y}`);
});
test('owned tree cleanup preserves shared geometry, materials and textures',()=>{
 const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),texture=new THREE.Texture();material.map=texture;
 const a=new THREE.Mesh(geometry,material),b=new THREE.Mesh(geometry,material),events=[];
 for(const [resource,name]of [[geometry,'geometry'],[material,'material'],[texture,'texture']])resource.addEventListener('dispose',()=>events.push(name));
 disposeOwnedSceneTree(a,[b]);assert.deepEqual(events,[]);assert.equal(material.map,texture);
 disposeOwnedSceneTree(a,[]);assert.deepEqual(events.sort(),['geometry','material','texture']);
});

test('shared camera close-up survives actual OrbitControls distance clamping',()=>{
 const h=harness({realControls:true}),session=h.host.open();h.controls.minDistance=.5;const next=session.setView({position:[0,0,.1],target:[0,0,0],near:.00001});
 assert.ok(Math.abs(next.position[2]-.1)<1e-8,'Actual orbit controls must preserve a valid close-up requested with a smaller near plane');h.controls.update();assert.ok(Math.abs(session.readView().position[2]-.1)<1e-8,'Following frames must preserve the applied close-up');
});
