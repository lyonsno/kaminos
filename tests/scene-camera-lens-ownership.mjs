import test from 'node:test';
import assert from 'node:assert/strict';
import * as camera from '../scene-camera.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createCameraViews} from '../scene-camera-views.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import fs from 'node:fs';
import vm from 'node:vm';
const record={id:'hero',type:'camera',source:'kaminos:camera',transform:{position:[0,0,3],rotation:[0,0,0],scale:[1,1,1]},camera:{lens:50,lensUnit:'fov',sensorWidth:36,sensorHeight:24,sensorFit:'auto',projection:'perspective',near:.1,far:1000}};
test('camera properties read canonical data instead of cloning the live Three helper',()=>{const source=fs.readFileSync(new URL('../authoring-cameras.mjs',import.meta.url),'utf8'),a=source.indexOf('const selectedCamera='),b=source.indexOf('const fieldsState=',a),context={selected:()=>({...record,object:{onRotationChange(){}}}),service:{read:()=>({cameras:[record]})}};vm.runInNewContext(source.slice(a,b)+'result=selectedCamera();',context);assert.doesNotThrow(()=>camera.cameraLensValue(context.result));assert.equal(context.result.object,undefined);});
test('lens unit survives normalization and the authored scene; invalid unit refuses',()=>{
 assert.equal(camera.checkedCameraRecord(record).camera.lensUnit,'fov');
 const normalized=camera.checkedCameraRecord(record),doc=buildSceneDocument({objects:[normalized]});assert.equal(planSceneRestore(doc).objects[0].camera.lensUnit,'fov');
 assert.throws(()=>camera.checkedCameraRecord({...record,camera:{...record.camera,lensUnit:'unknown'}}),/lens unit/i);
});
test('Blender angle presentation edits the same lens, independent of output aspect',()=>{
 assert.equal(typeof camera.cameraLensValue,'function','camera lens unit conversion is part of authored camera data');
 const degrees=camera.cameraLensValue(record);assert.ok(Math.abs(degrees-39.597752709)<1e-8);
 const patch=camera.cameraLensPatch(record,60);assert.ok(Math.abs(patch.lens-31.176914536)<1e-8);assert.deepEqual(Object.keys(patch),['lens']);
 assert.throws(()=>camera.cameraLensPatch(record,180),/field of view/i);
 const vertical={...record,camera:{...record.camera,sensorFit:'vertical'}};assert.ok(Math.abs(camera.cameraLensValue(vertical)-26.991466561)<1e-8);
});
test('free viewport lens changes and undo preserve camera-view pose, camera lens and active role',()=>{
 let objects=[structuredClone(record)],view={position:[2,3,5],target:[0,0,0],up:[0,1,0],fov:40,near:.1,far:1000};
 const edits=createSceneEdits({read:()=>null,write:()=>{}}),service=camera.createSceneCameras({edits,readObjects:()=>objects,writeCameras:x=>objects=structuredClone(x),readViewport:()=>view,writeViewport:x=>view=structuredClone(x),size:()=>({width:800,height:600})});
 assert.equal(typeof service.readNavigationView,'function','free navigation retains its own lens while viewing a camera');
 const views=createCameraViews({edits,readCamera:()=>view,writeCamera:x=>view=x,readLens:()=>({fov:service.readNavigationView().fov}),writeLens:x=>service.setNavigationLens(x.fov)});
 service.restore({schema:'kaminos.scene-camera.v1',activeId:'hero',aspect:[16,9]});service.enter();const shot=structuredClone(view),before=structuredClone(objects);views.setLens(65);
 assert.equal(service.readNavigationView().fov,65);assert.deepEqual(view,shot);assert.deepEqual(objects,before);assert.equal(service.state().mode,'camera');assert.equal(service.state().activeId,'hero');
 edits.undo();assert.equal(service.readNavigationView().fov,40);assert.deepEqual(view,shot);edits.redo();service.leave();assert.equal(view.fov,65);assert.deepEqual(objects,before);
});
