// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {buildSceneDocument,planSceneRestore,isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
import {Group} from '../lib/three.core.js';
import * as viewFan from '../view-fan.mjs';
import * as arrival from '../asset-arrival.mjs';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const view={position:[0,0,3],target:[0,0,0],up:[0,1,0],near:.01,far:100,fov:40};
const fan=()=>({schema:'kaminos.view-fan.v1',anchor:{objectId:'material',position:[0,0,0],normal:[0,0,1],uv:[.4,.6]},
 sourceView:view,context:{version:9,objects:[{id:'material',type:'pbr',source:'kaminos:neumip-carrier',neuralCarrier:{surface:'folded'}}],camera:view},radius:.4,spread:25,cardWidth:.8,
 views:[{angle:0,view,image,width:1,height:1}],renderer:{route:'viewport',backend:'WebGPU'}});
const record=()=>({id:'fan',type:'pbr',source:'kaminos:view-fan',label:'View fan',viewFan:fan(),
 transform:{position:[1,2,3],rotation:[0,.2,0],scale:[1,1,1]}});

test('a contextual view fan survives native admission and scene Save/Open with source context',()=>{
 const raw=record(),entry=createSceneObjectRecord(new Group(),raw,{id:raw.id});
 assert.deepEqual(entry.viewFan,raw.viewFan,'native admission must retain the fan views and original source context');
 raw.viewFan.anchor.position[0]=99;
 assert.equal(entry.viewFan.anchor.position[0],0,'the captured neighborhood must not alias live edits');
 const document=buildSceneDocument({objects:[{...raw,viewFan:entry.viewFan}],activeObjectId:'fan'});
 const restored=planSceneRestore(JSON.parse(JSON.stringify(document)));
 assert.deepEqual(restored.objects[0].viewFan,entry.viewFan);
 assert.equal(isReloadableSceneObjectRecord(restored.objects[0]),true,'a kept fan must have a real scene constructor');
});

test('missing source context or partial view pixels cannot masquerade as a reconstructible fan',()=>{
 for(const alter of [r=>delete r.viewFan.context,r=>r.viewFan.views[0].image='data:image/png;base64,',r=>r.viewFan.views[0].width=2]){
  const raw=record();alter(raw);assert.equal(isReloadableSceneObjectRecord(raw),false);
 }
});

test('view capture restores the borrowed viewport after a draw or pixel-copy failure',()=>{
 assert.equal(typeof viewFan.captureViewFan,'function','fan capture must preserve the current working viewport');
 for(const phase of ['success','begin','draw','copy','restore']){
  let state='original',restores=0;
  const invoke=()=>viewFan.captureViewFan({views:[{angle:0,view}],size:64,snapshot:()=>state,
   begin(){state='capture';if(phase==='begin')throw Error('begin failed');},
   present(){if(phase==='draw')throw Error('draw failed');},
   copy(){if(phase==='copy')throw Error('copy failed');return {image,width:1,height:1};},
   restore(previous){restores++;state=previous;if(phase==='restore')throw Error('restore failed');}});
  if(phase==='success')assert.equal(invoke()[0].image,image);else assert.throws(invoke,new RegExp(phase+' failed'));
  assert.equal(state,'original');assert.equal(restores,1);
 }
});

test('neighborhood extent determines the camera field without an artificial angular clamp',()=>{
 const rows=viewFan.viewFanCameras({sourceView:view,anchor:[0,0,0],radius:100,spread:25});
 assert.ok(rows[1].view.fov>175,'a valid wide neighborhood must not silently narrow to a preset field');
 for(const row of rows){assert.ok(Math.abs(Math.hypot(...row.view.position)-3)<1e-12);assert.deepEqual(row.view.target,[0,0,0]);}
});

test('scene export includes visible implicit studio lights without promoting or duplicating them',()=>{
 assert.equal(typeof arrival.sceneRecordsWithStudioLights,'function','the visible default rig must survive source-scene reconstruction');
 const plan=arrival.planArrivalStudioLights(),objects=[{id:'material',type:'pbr'}];
 const saved=arrival.sceneRecordsWithStudioLights(objects,plan.lights,[true,true]);
 assert.equal(saved.length,3);assert.equal(objects.length,1,'taking a scene snapshot must not change the working scene');
 assert.deepEqual(saved.slice(1).map(r=>r.light),plan.lights.map(r=>r.light));
 assert.equal(arrival.sceneRecordsWithStudioLights(saved,plan.lights,[true,true]).length,3);
 assert.deepEqual(arrival.sceneRecordsWithStudioLights(objects,plan.lights,[false,false]),objects);
});

 test('arrival preparation leaves an unloaded native texture pending until its image arrives',async()=>{
  const {Texture,Mesh,PlaneGeometry,MeshBasicMaterial}=await import('../lib/three.core.js');
  const texture=new Texture(),root=new Mesh(new PlaneGeometry(),new MeshBasicMaterial({map:texture}));
  arrival.prepareArrivedMeshMaterials(root,{maxAnisotropy:16});
  assert.equal(texture.anisotropy,16);
  assert.equal(texture.version,0,'null image must not become an uploadable GPU texture');
  texture.image={width:1,height:1,complete:true};texture.needsUpdate=true;
  assert.equal(texture.version,1,'the image loader can publish the prepared texture normally');
 });

test('source context excludes fan-only selection, header and warm-cache references',()=>{
 const raw={...fan().context,objects:[...fan().context.objects,record()],activeObjectId:'fan',activeGroupId:'only-fan',selectionIds:['fan'],groups:[{id:'only-fan',objectIds:['fan']},{id:'mixed',objectIds:['fan','material']}],model:{source:viewFan.VIEW_FAN_SOURCE},provenance:{source_url:viewFan.VIEW_FAN_SOURCE},transform:{position:[1,2,3]},materials:{color:'bad'},lodPreparation:{context:'old-fan-context'},editorDisplay:{hiddenIds:['fan','material']}};
 const result=viewFan.sourceSceneWithoutFans(raw);assert.equal(result.model,null);assert.equal(result.provenance,null);assert.equal(result.transform,null);assert.equal(result.materials,null);assert.equal(result.lodPreparation,null);
 assert.deepEqual(result.groups.map(g=>g.id),['mixed']);assert.equal(result.activeGroupId,null);assert.deepEqual(result.editorDisplay.hiddenIds,['material']);assert.equal(raw.objects.length,2);
 assert.doesNotThrow(()=>planSceneRestore(result));
});
test('fan admission rejects a retained context without its source carrier',()=>{
 const raw=record();raw.viewFan.context.objects=[];assert.equal(isReloadableSceneObjectRecord(raw),false);
});
test('captured-scene restore selects the fan without dangling current group membership',()=>{
 assert.equal(typeof viewFan.viewFanRestoreDocument,'function');
 const context={...fan().context,activeGroupId:'source-group',activeFieldId:'water-field',groups:[{id:'source-group',objectIds:['material']}]};
 const result=viewFan.viewFanRestoreDocument(context,{...record(),groupId:'new-group'});
 assert.equal(result.activeObjectId,'fan');assert.equal(result.activeGroupId,null);assert.equal(result.activeFieldId,null);assert.equal(result.objects.at(-1).groupId,null);assert.deepEqual(result.selectionIds,['fan']);assert.equal(context.objects.length,1);
});
test('a recognized fan root retains its owner type without caller metadata',()=>{
 const root=new Group();root.userData.kaminosViewFan=fan();
 const entry=createSceneObjectRecord(root,{}, {id:'fan'});assert.equal(entry.type,'pbr');assert.deepEqual(entry.viewFan,fan());
});
