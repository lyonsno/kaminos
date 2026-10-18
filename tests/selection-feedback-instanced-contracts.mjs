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
