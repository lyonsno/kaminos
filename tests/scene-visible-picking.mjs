// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
let api={};try{api=await import('../scene-visible-picking.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof api.visibleSceneIntersections,'function','Viewport picking needs visible descendants and screen-sized line hits');
const camera=new THREE.PerspectiveCamera(40,1,.01,1000);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();
const raycaster=new THREE.Raycaster();raycaster.setFromCamera(new THREE.Vector2(0,0),camera);
const root=new THREE.Group(),body=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));root.add(body);
const area=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(.5,-1,1),new THREE.Vector3(.5,1,1)]),new THREE.LineBasicMaterial());root.add(area);
const hidden=new THREE.Mesh(new THREE.PlaneGeometry(2,2),body.material);hidden.position.z=2;hidden.visible=false;root.add(hidden);root.updateMatrixWorld(true);
const read=()=>api.visibleSceneIntersections({raycaster,roots:[root],camera,viewport:{width:1000,height:1000}});
assert.equal(read()[0].object,body,'An off-ray area or hidden Bone stole the visible body');
area.position.x=-.49;root.updateMatrixWorld(true);assert.equal(read()[0].object,area,'A deliberately clicked outline cannot be selected');
area.visible=false;assert.equal(read()[0].object,body);root.visible=false;assert.equal(read().length,0,'Invisible parent descendants remained pickable');
root.visible=true;area.visible=true;area.position.x=0;camera.position.z=100;camera.updateMatrixWorld();raycaster.setFromCamera(new THREE.Vector2(),camera);
// Six screen pixels at this distance reach beyond the original one-unit budget.
area.position.x=1;area.geometry.translate(0,0,-300);area.geometry.computeBoundingSphere();root.updateMatrixWorld(true);
assert.ok(read().some(h=>h.object===area),'Screen-sized hits disappeared when zoomed out');
assert.equal(raycaster.params.Line.threshold,1,'Picking leaked its temporary line threshold');
console.log('Actual visible geometry, hidden descendants, screen-space outlines and threshold restoration');
