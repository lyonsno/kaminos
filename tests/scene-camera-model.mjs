import test from 'node:test';import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore,isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
const camera={id:'camera-hero',type:'camera',source:'kaminos:camera',label:'Kiln hero',transform:{position:[2,3,5],rotation:[0,.3,0],scale:[1,1,1]},camera:{projection:'perspective',lens:50,sensorWidth:36,sensorHeight:24,sensorFit:'auto',near:.01,far:1000}};
const sceneCamera={schema:'kaminos.scene-camera.v1',activeId:camera.id,aspect:[16,9]};
test('authored camera data and scene active camera survive the same scene document',()=>{
 assert.equal(isReloadableSceneObjectRecord(camera),true,'camera is an authored reloadable scene object');
 const doc=buildSceneDocument({objects:[camera],sceneCamera});assert.deepEqual(doc.objects[0].camera,{...camera.camera,lensUnit:'millimeters'});assert.deepEqual(doc.sceneCamera,sceneCamera);assert.deepEqual(planSceneRestore(doc).sceneCamera,sceneCamera);
});
test('scene active camera rejects dangling or non-camera references before restoration',()=>{
 const doc=buildSceneDocument({objects:[{id:'kiln',type:'glb',source:'/api/read?root=generated-meshes&path=kiln.glb'}]});
 assert.throws(()=>planSceneRestore({...doc,sceneCamera:{...sceneCamera,activeId:'kiln'}}),/camera/i);
 assert.throws(()=>planSceneRestore({...doc,sceneCamera:{...sceneCamera,activeId:'absent'}}),/camera/i);
});

import {createSceneCameras,cameraViewFromRecord,cameraPoseFromView,cameraFrameRect,normalizeSceneCamera} from '../scene-camera.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
const view={position:[2,3,5],target:[0,1,0],up:[0,1,0],fov:40,near:.01,far:1000};
function fixture(){let objects=[],viewport=structuredClone(view),counter=0;const writes=[];const edits=createSceneEdits({read:id=>structuredClone(objects.find(o=>o.id===id)?.transform),write:(id,pose)=>{objects.find(o=>o.id===id).transform=structuredClone(pose);}});const service=createSceneCameras({edits,readObjects:()=>objects,writeCameras:next=>{objects=structuredClone(next);},readViewport:()=>viewport,writeViewport:value=>{viewport=value;writes.push(structuredClone(value));},size:()=>({width:1000,height:800}),makeId:()=>String(++counter),capture:async(record,frame)=>({record,frame})});return {service,edits,writes,get objects(){return objects;},get viewport(){return viewport;},navigate(value){viewport=structuredClone(value);}};}
test('camera objects, active scene camera and the freely navigated viewport remain distinct',()=>{
 const f=fixture(),first=f.service.create('Hero'),second=f.service.create('Side');assert.equal(f.service.read().settings.activeId,first);
 f.service.setActive(second);const stored=structuredClone(f.objects);f.service.enter();assert.equal(f.service.state().mode,'camera');f.service.leave();assert.deepEqual(f.viewport,view);
 f.navigate({...view,position:[7,2,1]});assert.deepEqual(f.objects,stored);assert.equal(f.service.read().settings.activeId,second);
 const alignView=structuredClone(f.viewport);f.service.align();assert.deepEqual(f.objects[1].transform,cameraPoseFromView(alignView));assert.equal(f.service.state().mode,'camera');f.edits.undo();assert.deepEqual(f.objects,stored);f.edits.redo();
});
test('camera creation, active role and lens data share authored history without viewport navigation entries',()=>{
 const f=fixture(),id=f.service.create('Hero');f.service.updateData(id,{lens:85});assert.equal(f.objects[0].camera.lens,85);f.edits.undo();assert.notEqual(f.objects[0].camera.lens,85);f.edits.undo();assert.equal(f.objects.length,0);assert.equal(f.service.active(),null);f.edits.redo();assert.equal(f.service.active().id,id);
});
test('unlocked camera-frame pan/zoom changes only viewport presentation',()=>{
 const f=fixture();f.service.create('Hero');f.service.enter();const objects=structuredClone(f.objects),count=f.edits.state().undoCount;assert.equal(f.service.beginNavigation('pan'),true);f.service.panFrame(50,-20);f.service.zoomFrame(1.2);assert.deepEqual(f.objects,objects);assert.equal(f.edits.state().undoCount,count);assert.equal(f.service.beginNavigation('orbit'),false);assert.equal(f.service.state().mode,'user');assert.deepEqual(f.objects,objects);
});
test('lock-camera navigation previews the real camera object and cancellation restores it',()=>{
 const f=fixture(),id=f.service.create('Hero');f.service.enter();f.service.lock(true);const before=structuredClone(f.objects[0].transform),count=f.edits.state().undoCount;f.service.beginNavigation('pan');f.navigate({...f.viewport,position:[3,3,5],target:[1,1,0]});f.service.navigationChanged();assert.notDeepEqual(f.objects[0].transform,before);f.service.endNavigation(true);assert.deepEqual(f.objects[0].transform,before);assert.equal(f.edits.state().undoCount,count);
 f.service.beginNavigation('pan');f.navigate({...f.viewport,position:[4,3,5],target:[2,1,0]});f.service.navigationChanged();f.service.endNavigation(false);assert.equal(f.edits.state().undoCount,count+1);f.edits.undo();assert.deepEqual(f.objects[0].transform,before);assert.equal(f.service.active().id,id);
});
test('camera object scale does not change lens or shot aim; output frame retains aspect',()=>{
 const a=cameraViewFromRecord(camera),b=cameraViewFromRecord({...camera,transform:{...camera.transform,scale:[2,3,4]}});assert.deepEqual(a,b);
 const frame=cameraFrameRect(1000,800,16/9,.85);assert.ok(Math.abs(frame.width/frame.height-16/9)<1e-12);assert.ok(frame.x>0&&frame.y>0);assert.throws(()=>normalizeSceneCamera({...sceneCamera,aspect:[0,9]},[camera]),/frame/);
});
test('Add Camera creates Blender lens defaults at the initial cursor origin; bookmark conversion is explicit',()=>{const f=fixture(),id=f.service.create('Camera');const record=f.objects.find(o=>o.id===id);assert.equal(record.camera.lens,50);assert.equal(record.camera.near,.1);assert.deepEqual(record.transform.position,[0,0,0]);const converted=f.service.createFromView('Saved angle',view);assert.deepEqual(f.objects.find(o=>o.id===converted).transform.position,view.position);});
test('Blender Auto sensor fit uses the long frame dimension, including portrait shots',()=>{const wide=cameraViewFromRecord(camera,16/9),portrait=cameraViewFromRecord(camera,.5);const expected=2*Math.atan(36/100)*180/Math.PI;assert.ok(Math.abs(portrait.fov-expected)<1e-10);assert.ok(wide.fov<portrait.fov);});
test('new viewport state and camera identity ambiguity refuse before scene mutation',()=>{const doc=buildSceneDocument({objects:[camera],sceneCamera});assert.throws(()=>planSceneRestore({...doc,objects:[camera,camera]}),/camera.*identity|duplicate/i);assert.throws(()=>planSceneRestore({...doc,viewport:{mode:'camera',locked:false,userView:{...view,position:[null,1,2]}}}),/viewport|finite|camera/i);});
