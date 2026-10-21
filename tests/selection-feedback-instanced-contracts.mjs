// kaminos-test: node — the selection outline mask follows instanced geometry (TRELLIS surfels) and LOD level changes
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createSelectionFeedback} from '../scene-selection-feedback.mjs';
const createSelectionMaskProxies=createSelectionFeedback.maskProxies;
const feedbackFor=()=>{const scene=new THREE.Scene(),m=createSelectionMaskProxies(scene,{selected:new THREE.MeshBasicMaterial(),active:new THREE.MeshBasicMaterial()});return {update:m.update,proxies:m.proxies,state:()=>({meshCount:m.pairs().length})};};
import {buildSurfelField,createSurfelObject} from '../trellis-surfels.mjs';

function surfels(){
  const coords=new Int32Array([128,128,192,129,128,192,128,129,192,129,129,192]);
  const field=buildSurfelField({vertices:new Float32Array([...coords].map(v=>(v+.5)/512-.5)),triangles:new Uint32Array([0,1,3,0,3,2]),geometryCoordinates:coords,
    material:{coordinates:coords,features:new Float32Array(24),resolution:512}});
  return createSurfelObject(THREE,field,{levels:[1,2]});
}

test('a selected surfel object is outlined: its instanced chunks get instanced mask proxies sharing their instances',()=>{
  const feedback=feedbackFor(),object=surfels();object.updateMatrixWorld(true);
  feedback.update([{id:'s',object}],['s']);
  const instanced=[];object.traverse(o=>{if(o.isInstancedMesh)instanced.push(o);});
  assert.equal(feedback.state().meshCount,instanced.length,'one proxy per chunk level');
  const visible=feedback.proxies().filter(p=>p.visible);
  assert.equal(visible.length,instanced.filter(o=>{for(let p=o;p&&p!==object.parent;p=p.parent)if(!p.visible)return false;return true;}).length);
  for(const p of feedback.proxies()){assert.ok(p.isInstancedMesh);assert.ok(instanced.some(o=>o.instanceMatrix===p.instanceMatrix&&o.count===p.count));}
});

test('when a chunk switches level, the outline switches with it',()=>{
  const feedback=feedbackFor(),object=surfels();object.updateMatrixWorld(true);
  const lod=object.children.find(c=>c.isLOD);
  lod.levels.forEach((l,i)=>{l.object.visible=i===0;});feedback.update([{id:'s',object}],[]);
  const shown=()=>feedback.proxies().filter(p=>p.visible).map(p=>p.instanceMatrix);
  assert.deepEqual(shown(),[lod.levels[0].object.instanceMatrix]);
  lod.levels.forEach((l,i)=>{l.object.visible=i===1;});feedback.update([{id:'s',object}],[]);
  assert.deepEqual(shown(),[lod.levels[1].object.instanceMatrix],'the newly drawn level is outlined, the hidden one is not');
});

test('after the instances change, the outline is culled with the source\'s current bounds, not stale ones',()=>{
  const camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.z=5;camera.updateMatrixWorld();
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const make=()=>{const source=new THREE.InstancedMesh(new THREE.BoxGeometry(.2,.2,.2),new THREE.MeshBasicMaterial(),2);
    source.setMatrixAt(0,new THREE.Matrix4().makeTranslation(100,0,0));source.setMatrixAt(1,new THREE.Matrix4());source.count=1;source.computeBoundingSphere();return source;};
  for(const change of ['count','matrix']){
    const feedback=feedbackFor(),source=make();source.updateMatrixWorld(true);
    feedback.update([{id:'s',object:source}],[]);const [proxy]=feedback.proxies();
    assert.equal(frustum.intersectsObject(proxy),false,'initially both are off screen');
    if(change==='count')source.count=2;else{source.instanceMatrix=new THREE.InstancedBufferAttribute(new Float32Array(new THREE.Matrix4().toArray()),16);source.count=1;}
    source.computeBoundingSphere();feedback.update([{id:'s',object:source}],[]);
    assert.equal(frustum.intersectsObject(source),true);
    assert.equal(frustum.intersectsObject(proxy),true,`after a ${change} change the outline is drawn where its source is`);
  }
});

test('an automatic LOD change is outlined in the same frame the renderer draws it',()=>{
  const camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.z=20;camera.updateMatrixWorld();
  const scene=new THREE.Scene(),m=createSelectionMaskProxies(scene,{selected:new THREE.MeshBasicMaterial(),active:new THREE.MeshBasicMaterial(),camera});
  const object=surfels();object.updateMatrixWorld(true);const lod=object.children.find(c=>c.isLOD);
  const frame=()=>{m.update([{id:'s',object}],[]);lod.update(camera);};// page order: feedback update, then render (which updates LODs)
  frame();frame();
  camera.position.z=1;camera.updateMatrixWorld();frame();
  const drawn=lod.levels.map(l=>l.object.visible),outlined=lod.levels.map(l=>m.pairs().find(p=>p.source===l.object).proxy.visible);
  assert.notDeepEqual(drawn,[false,true],'the camera move crossed a level boundary');
  assert.deepEqual(outlined,drawn);
});
