// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as display from '../viewport-display-settings.mjs';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';
import {createWalkingPoseAdapter} from '../experiments/creature-motion/walking-pose.mjs';
import {frameObjects,sceneContentBounds} from '../scene-frame-selected.mjs';
const I=new THREE.Matrix4().toArray();
test('deforming creature casts and receives shadows; Bone markers are editor helpers',()=>{
 const runtime=createFullBodyRuntime({THREE,manifest:{bones:[{name:'pelvis',parent:null,restMatrix:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}],channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1])});
 assert.equal(runtime.mesh.castShadow,true,'Creature is omitted from all scene shadow maps');assert.equal(runtime.mesh.receiveShadow,true);
 const marker=runtime.bones.get('pelvis').children.find(c=>c.isMesh);assert.equal(marker.userData.kaminosHelperKind,'bones');assert.equal(marker.userData.kaminosEditorOnly,true);runtime.dispose();
});
test('master helpers gates bones and paths while retaining their individual preferences',()=>{
 assert.equal(typeof display.syncSceneHelperVisibility,'function','Dynamic creature helpers do not consume the common viewport settings');
 const root=new THREE.Group(),body=new THREE.Mesh(),bones=new THREE.Mesh(),path=new THREE.Line();bones.userData.kaminosHelperKind='bones';path.userData.kaminosHelperKind='paths';root.add(body,bones,path);
 const set=patch=>display.syncSceneHelperVisibility([root],display.checkedViewportDisplay({paths:true,...patch}));
 set({helpers:false});assert.equal(bones.visible,false);assert.equal(path.visible,false);assert.equal(body.visible,true);
 set({bones:false});assert.equal(bones.visible,false);assert.equal(path.visible,true);
 set({paths:false});assert.equal(bones.visible,true);assert.equal(path.visible,false);
 set({overlays:false});assert.equal(bones.visible,false);assert.equal(path.visible,false);
 assert.throws(()=>display.checkedViewportDisplay({bones:1}),/bones/);assert.throws(()=>display.checkedViewportDisplay({paths:null}),/paths/);
});
test('path guide uses the very same distance/heading route as creature playback',()=>{
 const adapter={frames:3,fps:30,jointNames:['pelvis'],frame:i=>({actorMatrix:new THREE.Matrix4().makeTranslation(0,.2,i).toArray(),bones:[{name:'pelvis',parent:null,localMatrix:I,worldMatrix:new THREE.Matrix4().makeTranslation(0,.2,i).toArray()}]})};
 const walk=createWalkingPoseAdapter({THREE,adapter,radius:4,blendFrames:0});assert.equal(typeof walk.guidePoints,'function','Effective motion path cannot be visualized');
 const guide=walk.guidePoints('path');assert.ok(guide.length>4);assert.deepEqual(guide[0],guide.at(-1));
 const p=walk.pathPoint(4);assert.ok(Math.abs(p[0]-4*(1-Math.cos(1)))<1e-9);assert.ok(Math.abs(p[2]-4*Math.sin(1))<1e-9);
 assert.deepEqual(walk.guidePoints('source'),[[0,.2,0],[0,.2,1],[0,.2,2]]);assert.throws(()=>walk.guidePoints('invented'),/mode/);
});
test('framing a creature ignores its editor path even when the guide is hidden',()=>{
 const root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry()));const camera=new THREE.PerspectiveCamera(40,1,.01,100),controls={target:new THREE.Vector3(),update(){}};camera.position.set(3,2,4);frameObjects([root],camera,controls);const before=camera.position.toArray();
 const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(100,0,100)]));line.visible=false;line.userData.kaminosEditorOnly=true;root.add(line);frameObjects([root],camera,controls);
 assert.ok(camera.position.toArray().every((v,i)=>Math.abs(v-before[i])<1e-9),'Motion guide makes Frame creature zoom out to the entire route');
});
test('framing travelled child content does not include its empty placement pivot',()=>{
 const root=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(2,3,4));root.userData.kaminosFrameContentOnly=true;body.position.set(1,0,-12);root.add(body);
 const guide=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-50,0,-50),new THREE.Vector3(50,0,50)]));guide.userData.kaminosEditorOnly=true;root.add(guide);
 const bodyBounds=sceneContentBounds(body),center=bodyBounds.getCenter(new THREE.Vector3()),radius=bodyBounds.getSize(new THREE.Vector3()).length()/2;
 for(const visible of [true,false]){guide.visible=visible;const camera=new THREE.PerspectiveCamera(40,1,.01,100),controls={target:new THREE.Vector3(),update(){}};camera.position.set(3,2,4);assert.equal(frameObjects([root],camera,controls),true);assert.ok(controls.target.distanceTo(center)<1e-9,'Frame includes the empty placement origin');assert.ok(Math.abs(camera.position.distanceTo(center)-radius/Math.sin(40*Math.PI/360)*1.12)<1e-9);}
});
