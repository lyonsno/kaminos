// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Mesh,MeshStandardMaterial,Raycaster,Vector3} from '../lib/three.core.js';
import {createSurfaceSplatObject} from '../surface-splat-object.mjs';
import {createResidentSolidMeshes} from '../scene-solid-gpu.mjs';
import {sceneContentBounds} from '../scene-frame-selected.mjs';
import {trianglesFromSceneObject} from '../volume-scene-solid.mjs';
import * as T from '../lib/three.core.js';
import {createGiProxyRegistry} from '../scene-gi-proxies.mjs';
import {createSceneBeautyLodController} from '../scene-lod-budget.mjs';

const payload=()=>({data:new Float32Array([0,0,0,0,0,1,.8,.3,.1,0,.5,1]),meta:{count:1,stride:12,radius:.03},footprints:new Float32Array([1,0,0,.06,0,1,0,.06])});
test('scene consumers see the placed source shape, not fullscreen resolve triangles',()=>{
 const object=createSurfaceSplatObject(new Mesh(new BoxGeometry(.6,.4,.2),new MeshStandardMaterial()),payload());object.position.set(.2,.3,.4);object.updateWorldMatrix(true,true);
 assert.equal(trianglesFromSceneObject(object).triangles.length,12);
 const resident=createResidentSolidMeshes({upload:x=>x,release(){}}),rows=resident.update([{id:'hybrid',object}],{translate:[0,0,0],scale:1});
 assert.equal(rows[0].triangleCount,12);assert.equal(rows[0].draws.length,1);
 const bounds=sceneContentBounds(object);assert.ok(Math.abs(bounds.max.x-.5)<1e-6);assert.ok(Math.abs(bounds.min.z-.3)<1e-6);
 const ordinaryBounds=new T.Box3().setFromObject(object,true);assert.ok(Math.abs(ordinaryBounds.max.x-.5)<1e-6,'ordinary scene bounds must exclude the fullscreen carrier extent');
 const hits=new Raycaster(new Vector3(.2,.3,2),new Vector3(0,0,-1)).intersectObject(object,true);
 assert.ok(hits.length);assert.ok(hits.every(hit=>hit.object===object));
 object.dispose();resident.destroy();
});
test('clones reconstruct independently and keep the same source and optics',()=>{
 const object=createSurfaceSplatObject(new Mesh(new BoxGeometry(),new MeshStandardMaterial()),payload());object.splats.set({ior:1.6});
 const copy=object.clone();assert.notEqual(copy.splats,object.splats);assert.equal(copy.splats.read().ior,1.6);
 assert.notEqual(copy.splats.root.children[0].material,object.splats.root.children[0].material);
 copy.dispose();assert.doesNotThrow(()=>object.splats.set({ior:1.5}));object.dispose();object.dispose();
});
test('proxy tiers remain available to physics without replacing splat beauty with the fallback mesh',async()=>{
 const object=createSurfaceSplatObject(new Mesh(new BoxGeometry(),new MeshStandardMaterial()),payload()),scene=new T.Scene();scene.add(object);
 object.userData.kaminosSceneObject={id:'splats',source:'/api/read?root=generated-meshes&path='+('a'.repeat(64))+'.glb'};
 const levels=[{faces:1,sha256:'b'.repeat(64),error:{relative:{p95:0,max:0}}}];let loads=0;
 const registry=createGiProxyRegistry({THREE:T,fetchJson:async()=>({levels,choice:null})});
 const handle=await registry.attach(object);assert.equal(handle.representation,'surface-splats');assert.equal(handle.levels.length,1);
 const controller=createSceneBeautyLodController({THREE:T,scene,giProxies:registry,loadLevel:async()=>{loads++;return new T.Group();},settings:{faceBudget:1}}),camera=new T.PerspectiveCamera(40,1,.1,100);camera.position.z=20;camera.updateMatrixWorld(true);
 controller.update(camera,192);assert.equal(loads,0);assert.equal(object.splats.root.visible,true);controller.dispose();registry.clear();object.dispose();
});
