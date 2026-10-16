// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneResourceFinalizers} from '../scene-resource-finalizers.mjs';
const unavailable=()=>{throw Error('Shared scene host adapter is unavailable on baseline');};
const {createWorkbenchFrameService=unavailable,createWorkbenchSceneHost=unavailable,disposeOwnedSceneTree=unavailable}=await import('../workbench-scene-host.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url?.endsWith('/workbench-scene-host.mjs'))return {};
 throw error;
});
function harness(){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,100);
 camera.position.set(0,1,5);
 const controls={target:new THREE.Vector3(),enableDamping:true,update(){camera.lookAt(this.target);}};
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
});
test('owned tree cleanup preserves shared geometry, materials and textures',()=>{
 const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),texture=new THREE.Texture();material.map=texture;
 const a=new THREE.Mesh(geometry,material),b=new THREE.Mesh(geometry,material),events=[];
 for(const [resource,name]of [[geometry,'geometry'],[material,'material'],[texture,'texture']])resource.addEventListener('dispose',()=>events.push(name));
 disposeOwnedSceneTree(a,[b]);assert.deepEqual(events,[]);assert.equal(material.map,texture);
 disposeOwnedSceneTree(a,[]);assert.deepEqual(events.sort(),['geometry','material','texture']);
});


test('completed publication is a separate synchronous phase before all render consumers',()=>{
 const order=[],errors=[],service=createWorkbenchFrameService({onError:error=>errors.push(error.message)});
 service.onFrame(()=>order.push('prepare'));
 service.onBeforeRender(()=>order.push('publish'));
 service.tick(10);assert.deepEqual(order,['prepare']);
 assert.equal(service.beforeRender(),true);order.push('depth','ssgi','beauty');
 assert.deepEqual(order,['prepare','publish','depth','ssgi','beauty']);
 const cancel=service.onBeforeRender(()=>Promise.resolve());
 assert.equal(service.beforeRender(),false,'async work cannot be reported as completed publication');
 assert.match(errors.at(-1),/synchronous/);cancel();assert.equal(service.beforeRender(),true);
});

test('GPU access borrows the actual renderer device and rejects mismatched or unavailable routes',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),canvas={},adapter={info:{isFallbackAdapter:false}},device={};
 const renderer={backend:{isWebGPUBackend:true,device},domElement:canvas},controls={domElement:canvas,target:new THREE.Vector3()};
 let effective={renderer,device,adapter,scene,camera,controls};
 const host=createWorkbenchSceneHost({scene,camera,controls,getGpu:()=>effective,removeObject(){},redraw(){},onFrame(){},onBeforeRender(){}}),session=host.open();
 const borrowed=session.gpu();assert.equal(borrowed.device,device);assert.equal(borrowed.renderer,renderer);assert.equal(borrowed.scene,scene);assert.equal(borrowed.controls,controls);
 effective={...effective,device:{}};assert.throws(()=>session.gpu(),/device/);
 effective=null;assert.throws(()=>session.gpu(),/unavailable/);
});

test('session disposal cancels synchronous publication and rejects stale GPU access',async()=>{
 const callbacks=new Set(),h=harness();
 const host=createWorkbenchSceneHost({scene:h.scene,camera:h.camera,controls:h.controls,removeObject(){},redraw(){},onFrame:h.frameService.onFrame,
  onBeforeRender:callback=>{callbacks.add(callback);return()=>callbacks.delete(callback);}});
 const session=host.open();let calls=0;session.onBeforeRender(()=>++calls);const stale=[...callbacks][0];stale();
 await session.dispose();stale();assert.equal(calls,1);assert.equal(callbacks.size,0);assert.throws(()=>session.gpu(),/disposed/);
});


test('owned producer attachment transfers final resource cleanup without a second tree disposal',async()=>{
 const h=harness(),finalizers=createSceneResourceFinalizers(),root=new THREE.Group();let calls=0;
 const host=createWorkbenchSceneHost({scene:h.scene,camera:h.camera,controls:h.controls,loadAsset:async()=>{},
  registerObject:h.register,findObject:value=>[...h.rows.values()].find(row=>row.object===value),
  removeObject:handle=>{h.scene.remove(handle.root);h.rows.delete(handle.id);return finalizers.retire(handle.root);},
  finalizers,redraw(){},onFrame:h.frameService.onFrame});
 const session=host.open();await session.attach(root,{owned:true,finalize:value=>{assert.equal(value,root);++calls;}});
 assert.equal(finalizers.canRestore(root),true);await session.dispose();await session.dispose();assert.equal(calls,1);
});

test('final retirement cancels producer scheduling and publication even while its session is open',async()=>{
 const h=harness(),finalizers=createSceneResourceFinalizers(),root=new THREE.Group();let destroyed=false,ticks=0,publishes=0;
 const service=createWorkbenchFrameService({onError:error=>{throw error;}});
 const host=createWorkbenchSceneHost({scene:h.scene,camera:h.camera,controls:h.controls,loadAsset:async()=>{},
  registerObject:h.register,findObject:value=>[...h.rows.values()].find(row=>row.object===value),
  removeObject:handle=>{h.scene.remove(handle.root);h.rows.delete(handle.id);return finalizers.retire(handle.root);},
  finalizers,redraw(){},onFrame:service.onFrame,onBeforeRender:service.onBeforeRender});
 const session=host.open();await session.attach(root,{owned:true,finalize:()=>{destroyed=true;}});
 session.onFrame(()=>{if(destroyed)throw Error('tick used retired allocation');++ticks;});
 session.onBeforeRender(()=>{if(destroyed)throw Error('publication used retired allocation');++publishes;});
 service.tick(0);assert.equal(service.beforeRender(),true);
 root.removeFromParent();await finalizers.retire(root); // The app's scene-replacement finalizer boundary.
 service.tick(10);assert.equal(service.beforeRender(),true,'retiring the old producer must leave replacement draws usable');
 assert.equal(ticks,1);assert.equal(publishes,1);assert.equal(service.state().publicationSubscriptions,0);
 assert.throws(()=>session.onBeforeRender(()=>{}),/retired|disposed/);
 await session.dispose();
});
