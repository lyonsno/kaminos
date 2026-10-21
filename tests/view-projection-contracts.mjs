// kaminos-test: node
// Orthographic views on the shared perspective camera, as Blender's: the view keeps its size
// at the orbit pivot, zooming still works, and an axis view's orthographic mode ends when the
// view is orbited away (Auto Perspective), while one chosen explicitly stays.
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createViewProjection} from '../view-projection.mjs';

const camera=new THREE.PerspectiveCamera(40,1.5,.01,100),target=new THREE.Vector3(0,0,0);
camera.position.set(0,0,5);camera.lookAt(target);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
const view=createViewProjection({camera,target:()=>target});
const ndcY=point=>new THREE.Vector3(...point).project(camera).y;
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-6,`${message}: ${a} vs ${b}`);

assert.deepEqual(view.state(),{orthographic:false,auto:false});
const before=ndcY([0,1,0]);
view.setOrthographic(true);
assert.equal(camera.isOrthographicCamera,true);assert.equal(camera.isPerspectiveCamera,false);
assert.equal(camera.projectionMatrix.elements[15],1,'an orthographic projection');
near(ndcY([0,1,0]),before,'the pivot plane keeps its size on screen');
near(ndcY([0,1,-3]),before,'and depth no longer shrinks things');
// Helpers that size themselves from an orthographic camera's frustum (the transform gizmo) see the visible height.
near((camera.top-camera.bottom)/camera.zoom,2/before,'top and bottom describe the visible height');
near((camera.right-camera.left)/(camera.top-camera.bottom),camera.aspect,'and left and right its width');

camera.aspect=2;camera.updateProjectionMatrix();
assert.equal(camera.projectionMatrix.elements[15],1,'a resize keeps the view orthographic');
near(ndcY([0,1,0]),before,'with the same vertical size');

camera.position.set(0,0,2.5);camera.updateMatrixWorld(true);view.update();
near(ndcY([0,1,0]),2*before,'moving to half the distance zooms in twice as far');

// Auto Perspective: an axis view's orthographic mode ends when the view turns.
view.setOrthographic(true,{auto:true});
camera.position.set(0,0,2.5);camera.lookAt(target);camera.updateMatrixWorld(true);view.update();
assert.equal(view.state().orthographic,true,'panning or zooming keeps it');
camera.position.set(1,0,2.5);camera.lookAt(target);camera.updateMatrixWorld(true);view.update();
assert.deepEqual(view.state(),{orthographic:false,auto:false},'orbiting away returns to perspective');
assert.equal(camera.isPerspectiveCamera,true);assert.equal(camera.isOrthographicCamera,false);
assert.equal(camera.projectionMatrix.elements[11],-1,'a perspective projection again');

// Chosen explicitly (Numpad 5), it stays through orbiting.
view.toggle();
camera.position.set(0,1,2.5);camera.lookAt(target);camera.updateMatrixWorld(true);view.update();
assert.deepEqual(view.state(),{orthographic:true,auto:false});
view.toggle();assert.equal(view.state().orthographic,false);

// In WebGPU's coordinate system the orthographic near plane is clip depth 0, as the renderer expects.
{
  const gpu=new THREE.PerspectiveCamera(40,1,.5,10);gpu.coordinateSystem=THREE.WebGPUCoordinateSystem;gpu.position.set(0,0,5);gpu.updateMatrixWorld(true);gpu.updateProjectionMatrix();
  createViewProjection({camera:gpu,target:()=>new THREE.Vector3()}).setOrthographic(true);
  near(new THREE.Vector3(0,0,4.5).project(gpu).z,0,'the near plane is depth 0');
  near(new THREE.Vector3(0,0,-5).project(gpu).z,1,'the far plane is depth 1');
}

