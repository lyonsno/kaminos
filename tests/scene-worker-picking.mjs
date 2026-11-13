// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneWorkerAuthoring} from '../scene-worker-authoring.mjs';
import {captureSceneWorkerCamera} from '../scene-worker-page.mjs';
import {registerPresentedSurface} from '../scene-presented-surface.mjs';
const ctx={assertCurrent(){}};
function fixture(){
 const scene=createWorkingScene(),hidden=new Set(),camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.z=5;camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 const meshes=[];for(const [id,z]of [['back',0],['front',1]]){const object=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());object.position.z=z;object.updateMatrixWorld(true);scene.put({id,type:'glb',object,label:id});meshes.push(object);}
 const ordinary={camera,workingScene:scene,visible:id=>!hidden.has(id),viewport:()=>({width:100,height:100,pixelRatio:1}),readBounds:()=>null,
  authored:{snapshot:()=>({objects:scene.objects.map(({id,type})=>({id,type})),groups:scene.groups,selection:scene.selection})}};
 const authoring=createSceneWorkerAuthoring({THREE,ordinary}),input={ndc:{x:0,y:0},viewport:{width:100,height:100},camera:captureSceneWorkerCamera(camera,new THREE.Vector3()),extend:false};
 return {scene,hidden,camera,ordinary,authoring,input,meshes,dispose(){for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}}};
}
function pick(f,patch={}){assert.equal(typeof f.authoring.commands['scene.pick'],'function','worker must pick actual registered geometry inside foreground admission');return f.authoring.commands['scene.pick']({...f.input,...patch},ctx);}
test('foreground picking selects the nearest actual visible root and updates canonical selection',()=>{
 const f=fixture();try{assert.deepEqual(pick(f).ui.selection,{ids:['front'],activeId:'front'});f.hidden.add('front');assert.deepEqual(pick(f).ui.selection,{ids:['back'],activeId:'back'});f.hidden.clear();f.scene.find('front').object.visible=false;assert.equal(pick(f).ui.selection.activeId,'back');}finally{f.dispose();}
});
test('picking uses the click camera without changing the live render camera and Shift uses current selection',()=>{
 const f=fixture();try{pick(f);f.hidden.add('front');assert.deepEqual(pick(f,{extend:true}).ui.selection.ids,['front','back']);assert.deepEqual(pick(f,{extend:true}).ui.selection.ids,['front']);
  const click=f.camera.clone();click.position.x=4;click.lookAt(4,0,0);click.updateMatrixWorld(true);const prior=f.camera.matrixWorld.clone();assert.deepEqual(pick(f,{camera:captureSceneWorkerCamera(click,new THREE.Vector3(4,0,0))}).ui.selection.ids,[]);assert.deepEqual(f.camera.matrixWorld.elements,prior.elements);
 }finally{f.dispose();}
});
test('the displayed LOD maps back to its actual authored owner',()=>{
 const f=fixture();try{const displayed=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());f.meshes.push(displayed);displayed.updateMatrixWorld(true);f.ordinary.beautyLods={interactiveRoots:()=>[displayed],interactiveOwner:()=>f.scene.find('back').object};assert.equal(pick(f).ui.selection.activeId,'back');}finally{f.dispose();}
});
test('unsupported presented-surface picking refuses before submitting or changing selection',()=>{
 const f=fixture();let calls=0;const unregister=registerPresentedSurface(f.meshes[0],{mesh:f.meshes[0],pick(){calls++;return Promise.resolve(null);}});
 try{assert.equal(typeof f.authoring.commands['scene.pick'],'function');assert.throws(()=>pick(f),/presented.surface.*picking|asynchronous.*picking/i);assert.equal(calls,0);assert.deepEqual(f.scene.selection.ids,[]);}finally{unregister();f.dispose();}
});
test('invalid click geometry or stale admission cannot alter selection',()=>{
 const f=fixture();try{assert.equal(typeof f.authoring.commands['scene.pick'],'function');for(const patch of [{ndc:{x:NaN,y:0}},{ndc:{x:2,y:0}},{viewport:{width:0,height:100}}])assert.throws(()=>pick(f,patch));assert.throws(()=>f.authoring.commands['scene.pick'](f.input,{assertCurrent(){throw Error('stale click');}}),/stale click/);assert.deepEqual(f.scene.selection.ids,[]);}finally{f.dispose();}
});


test('missing camera is rejected explicitly before changing selection',()=>{
 const f=fixture();try{pick(f);for(const camera of [null,undefined])assert.throws(()=>pick(f,{camera}),/^Error: Scene worker requires its perspective camera snapshot$/);assert.deepEqual(f.scene.selection.ids,['front']);}finally{f.dispose();}
});
test('viewport and ordinary selection preserve authored assembly boundaries and Shift toggling',()=>{
 const f=fixture();try{
  f.scene.setGroups([{id:'burner',objectIds:['front'],assembly:{kind:'burner',roles:{front:'body'}}}]);
  assert.deepEqual(pick(f).ui.selection,{ids:['@group:burner'],activeId:'@group:burner'});
  assert.deepEqual(pick(f,{extend:true}).ui.selection.ids,[]);
  assert.deepEqual(f.authoring.commands['scene.select']({ids:['front'],activeId:'front'},ctx).ui.selection.ids,['@group:burner']);
  f.hidden.add('front');assert.deepEqual(pick(f,{extend:true}).ui.selection.ids,['@group:burner','back']);
 }finally{f.dispose();}
});
