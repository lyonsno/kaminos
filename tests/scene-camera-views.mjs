import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
const view={position:[2,3,5],target:[0,1,0],up:[0,1,0],near:.01,far:1000,fov:45};
const views={schema:'kaminos.camera-views.v1',selectedId:'front',items:[{id:'front',label:'Kiln front',view}]};
const objects=[{id:'kiln',type:'glb',source:'/api/read?root=generated-meshes&path=kiln.glb'}];
test('named camera views survive scene save and restore beside the independent viewport camera',()=>{
  const camera={...view,position:[8,4,3]};const saved=buildSceneDocument({objects,camera,cameraViews:views});
  assert.deepEqual(saved.cameraViews,views,'scene save must retain authored camera views');
  assert.deepEqual(saved.camera,camera);assert.deepEqual(planSceneRestore(saved).cameraViews,views);
});
test('legacy scenes restore an empty view collection; invalid new views fail before scene mutation',()=>{
  const saved=buildSceneDocument({objects,camera:view});assert.deepEqual(planSceneRestore(saved).cameraViews,{schema:'kaminos.camera-views.v1',selectedId:null,items:[]});
  assert.throws(()=>planSceneRestore({...saved,cameraViews:{...views,items:[{...views.items[0],view:{...view,fov:180}}]}}),/camera|field of view/i);
});

import {createCameraViews,normalizeCameraViews,cameraViewsMatch} from '../scene-camera-views.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
function fixture(){
 let camera=structuredClone(view),counter=0,blocked=false,failWrite=false,captures=[];
 const edits=createSceneEdits({read:()=>null,write:()=>{}});
 const service=createCameraViews({edits,readCamera:()=>camera,writeCamera:next=>{camera=structuredClone(next);if(failWrite){failWrite=false;throw Error('view consumer refused');}},admit:()=>{if(blocked)throw Error('Document busy');},makeId:()=>String(++counter),capture:async item=>{captures.push(item);return {ok:true};}});
 return {service,edits,captures,get camera(){return structuredClone(camera);},navigate(next){camera=structuredClone(next);},block(){blocked=true;},fail(){failWrite=true;}};
}
test('save, explicit update, rename, duplicate and removal share the chronological scene ledger',()=>{
 const f=fixture(),first=f.service.save('Front');assert.equal(f.edits.state().undoCount,1);
 const moved={...view,position:[9,2,6]};f.navigate(moved);assert.equal(f.service.differs(),true);assert.deepEqual(f.service.read().items[0].view,view);
 f.service.update(first.id);assert.equal(f.service.differs(),false);f.edits.undo();assert.deepEqual(f.service.read().items[0].view,view);assert.deepEqual(f.camera,moved,'record undo must not navigate');f.edits.redo();
 f.service.rename(first.id,'Front revised');f.service.duplicate();const duplicate=f.service.read().selectedId;
 f.service.remove(duplicate);f.edits.undo();assert.equal(f.service.read().selectedId,duplicate);f.edits.redo();assert.equal(f.service.read().items.length,1);
 f.service.select(first.id);assert.deepEqual(f.camera,moved);assert.equal(f.service.read().items[0].label,'Front revised');
});
test('lens gesture cancel and undo restore lens while retaining a later navigated camera pose',()=>{
 const f=fixture();f.service.save('Front');f.edits.begin('@viewport-lens','Lens');f.edits.preview({fov:30});f.edits.preview({fov:25});f.edits.cancel();assert.deepEqual(f.camera,view);
 f.service.setLens(30);const moved={...f.camera,position:[10,8,4],target:[2,1,0]};f.navigate(moved);f.edits.undo();assert.deepEqual(f.camera,{...moved,fov:45});f.edits.redo();assert.deepEqual(f.camera,moved);
 assert.deepEqual(f.service.read().items[0].view,view,'lens preview does not overwrite saved views');
});
test('invalid lens and records refuse without mutating accepted view, collection or history',()=>{
 const f=fixture();f.service.save('Front');const before=f.service.read(),history=f.edits.state();
 for(const fov of [0,180,NaN])assert.throws(()=>f.service.setLens(fov),/field of view/);
 assert.throws(()=>f.service.save(' '),/Name/);assert.throws(()=>f.service.restore({...before,selectedId:'missing'}),/missing/);
 assert.throws(()=>normalizeCameraViews({...views,items:[views.items[0],views.items[0]]}),/unique/);
 assert.deepEqual(f.camera,view);assert.deepEqual(f.service.read(),before);assert.deepEqual(f.edits.state(),history);
});
test('failed consumer recall rolls camera back and leaves selected record unchanged',()=>{
 const f=fixture();const first=f.service.save('First');f.navigate({...view,position:[8,5,4]});const second=f.service.save('Second'),before=f.camera;
 f.fail();assert.throws(()=>f.service.select(first.id),/consumer refused/);assert.deepEqual(f.camera,before);assert.equal(f.service.read().selectedId,second.id);
});
test('capture recalls the stored perspective view and retains its identity for the consumer',async()=>{
 const f=fixture();const saved=f.service.save('Kiln hero');f.navigate({...view,position:[8,2,4]});assert.deepEqual(await f.service.capture(),{ok:true});assert.deepEqual(f.camera,view);assert.deepEqual(f.captures,[saved]);
});
test('camera commands refuse while a scene edit or document action is in flight',()=>{
 const f=fixture();f.service.save('Front');f.edits.begin('@viewport-lens');assert.throws(()=>f.service.select('1'),/Finish/);assert.throws(()=>f.service.save('Other'),/Finish/);f.edits.cancel();f.block();assert.throws(()=>f.service.select('1'),/busy/);assert.deepEqual(f.camera,view);
});
test('complete view comparison includes target, up, clipping and lens',()=>{
 assert.equal(cameraViewsMatch(view,structuredClone(view)),true);
 for(const changed of [{fov:40},{near:.02},{far:2000},{up:[1,1,0]},{target:[0,2,0]},{position:[3,3,5]}])assert.equal(cameraViewsMatch(view,{...view,...changed}),false);
});
