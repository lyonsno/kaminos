// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SceneTransformControls} from '../scene-transform-gizmo.mjs';
function fixture(position=[4,3,6]) {
 const camera=new THREE.PerspectiveCamera(50,1.25,.01,100);camera.position.fromArray(position);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const canvas=Object.assign(new EventTarget(),{style:{},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800}),ownerDocument:{pointerLockElement:null}});
 const object=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),scene=new THREE.Scene();scene.add(object);
 const gizmo=new SceneTransformControls(camera,canvas);gizmo.setSize(.75);scene.add(gizmo.getHelper());gizmo.attach(object);scene.updateMatrixWorld(true);
 function update(mode='translate'){gizmo.setMode(mode);scene.updateMatrixWorld(true);}
 function point(axis,t){const handle=gizmo._gizmo.gizmo[gizmo.mode].children.find(h=>h.name===axis);const p=new THREE.Vector3();p.setComponent('XYZ'.indexOf(axis),t);return p.applyMatrix4(handle.matrixWorld).project(camera);}
 return {camera,canvas,object,scene,gizmo,point,update};
}
for(const mode of ['translate','scale']) test(mode+' has positive axis handles with an open center instead of opposing handles',()=>{
 const f=fixture();f.update(mode);
 for(const axis of ['X','Y','Z'])for(const handle of f.gizmo._gizmo.gizmo[mode].children.filter(h=>h.name===axis)){
  handle.geometry.computeBoundingBox();assert.ok(handle.geometry.boundingBox.min.getComponent('XYZ'.indexOf(axis))>=.1-1e-6,axis+' grips leave room around the center and do not extend behind it');
 }
});
test('the visible X shaft wins over the overlapping YZ plane at a reversed camera angle',()=>{
 const f=fixture([-4,3,6]);f.gizmo.pointerHover(f.point('X',.18));assert.equal(f.gizmo.axis,'X');
});
test('the empty space behind a positive axis is free for scene selection',()=>{
 const f=fixture();f.gizmo.pointerHover(f.point('X',-.4));assert.equal(f.gizmo.axis,null);
});
test('visible positive arrow and scale tips pick their own axis from different views',()=>{
 for(const position of [[4,3,6],[-4,3,6],[6,1,1]])for(const mode of ['translate','scale'])for(const axis of ['X','Y','Z']){
  const f=fixture(position);f.update(mode);const handle=f.gizmo._gizmo.gizmo[mode].children.find(h=>h.name===axis);if(!handle.visible)continue;
  f.gizmo.pointerHover(f.point(axis,.56));assert.equal(f.gizmo.axis,axis,JSON.stringify({position,mode,axis}));
 }
});
test('a hidden helper cannot acquire a transform axis',()=>{
 const f=fixture();const p=f.point('X',.5);f.gizmo.getHelper().visible=false;f.gizmo.pointerHover(p);assert.equal(f.gizmo.axis,null);
});

test('the visible X rotation arc and its picker share the same half-circle',()=>{
 const f=fixture();f.update('rotate');const grip=f.gizmo._gizmo.gizmo.rotate.children.find(h=>h.name==='X');
 const visiblePoint=new THREE.Vector3(Math.cos(.6)*.5,Math.sin(.6)*.5,0).applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2).applyMatrix4(grip.matrixWorld).project(f.camera);
 f.gizmo.pointerHover(visiblePoint);assert.equal(f.gizmo.axis,'X');
});

test('changing World to Local invalidates projected handles without requiring camera motion',()=>{
 const f=fixture();f.object.rotation.z=.7;f.scene.updateMatrixWorld(true);f.gizmo.pointerHover(f.point('X',.56));
 f.gizmo.setSpace('local');f.scene.updateMatrixWorld(true);f.gizmo.pointerHover(f.point('X',.56));assert.equal(f.gizmo.axis,'X');
});
