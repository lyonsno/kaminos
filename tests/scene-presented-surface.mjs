// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {visibleSceneIntersections} from '../scene-visible-picking.mjs';
let api={};try{api=await import('../scene-presented-surface.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof api.registerPresentedSurface,'function','A posed surface must replace authored rest geometry for native selection');
const source=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial()),surface=new THREE.Mesh(),root=new THREE.Group();root.add(source);root.updateMatrixWorld(true);
const camera=new THREE.PerspectiveCamera(40,1,.01,100);camera.position.z=10;camera.updateMatrixWorld(true);const raycaster=new THREE.Raycaster();raycaster.setFromCamera(new THREE.Vector2(),camera);
let resolve,ray;
const registration=api.registerPresentedSurface(source,{mesh:surface,pick:r=>{ray=r;return new Promise(r=>{resolve=r;});}});
const pick=()=>visibleSceneIntersections({raycaster,roots:[root],camera,viewport:{width:100,height:100}});
const pending=pick();assert.ok(pending instanceof Promise);assert.equal(ray.origin.z,10);
raycaster.ray.origin.z=100;assert.equal(ray.origin.z,10,'Pending pick must retain its own ray');
resolve({distance:5,point:new THREE.Vector3(0,0,5),faceIndex:3});const hits=await pending;
assert.equal(hits.length,1,'Invisible rest mesh cannot contribute another hit');assert.equal(hits[0].object,source);assert.equal(hits[0].surfaceObject,surface);
root.visible=false;assert.deepEqual(pick(),[]);root.visible=true;
const stale=pick();registration();resolve({distance:2});assert.deepEqual(await stale,[],'Disposed surface cannot publish a stale click');
assert.equal(api.presentedSurface(source),null);
const release1=api.registerPresentedSurface(source,{mesh:surface,pick:async()=>null});
const latest={mesh:surface,pick:async()=>null},release2=api.registerPresentedSurface(source,latest);release1();assert.equal(api.presentedSurface(source),latest);release2();
console.log('Presented selection owns current geometry and rejects stale async results');
