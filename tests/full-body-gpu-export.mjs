// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';
import {createGpuSkinDeformer} from '../experiments/creature-motion/gpu-skin-deformer.mjs';
import {exportCloneInWorld} from '../scene-export.mjs';

globalThis.FileReader ??= class {
  #finish(result){this.result=result;this.onload?.({target:this});this.onloadend?.({target:this});}
  readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>this.#finish(b));}
  readAsDataURL(blob){blob.arrayBuffer().then(b=>this.#finish(`data:${blob.type};base64,${Buffer.from(b).toString('base64')}`));}
};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const data={manifest:{bones:[{name:'pelvis',parent:null,restMatrix:I}],channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1])};
function meshes(root){const result=[];root.traverse(o=>{if(o.isMesh)result.push(o);});return result;}
function near(a,b){assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<1e-5,`${i}: ${a[i]} versus ${b[i]}`);}

test('GPU creature exports an independent current-pose XYZ snapshot through the ordinary clone and GLB route',async()=>{
 const r=createFullBodyRuntime({THREE,...data,deformerFactory:createGpuSkinDeformer});
 try{
  const parent=new THREE.Group();parent.position.set(4,1,-3);parent.rotation.y=.4;parent.add(r.group);r.group.position.set(2,0,1);r.group.scale.setScalar(1.2);
  r.bones.get('pelvis').position.x=2;r.update();
  const live=r.mesh.geometry,rest=live.attributes.position.array.slice();
  const clone=exportCloneInWorld(r.group),body=meshes(clone).find(m=>m.userData.kaminosDynamicGeometry);
  assert.equal(body.geometry.attributes.position.itemSize,3,'export must use posed XYZ, not rest-backed vec4 GPU storage');
  near([...body.geometry.attributes.position.array],[2,0,0,3,0,0,2,1,0]);
  assert.notEqual(body.geometry,r.syncCpuGeometry(),'the export owns its geometry, not the invalidatable runtime mirror');
  assert.equal(r.mesh.geometry,live);assert.deepEqual(live.attributes.position.array,rest);
  near(clone.matrixWorld.elements,r.group.matrixWorld.elements);
  // Retain the first snapshot through a later pose and skin invalidation.
  r.bones.get('pelvis').position.x=3;r.update();r.replaceSkin({...data,rest:new Float32Array([0,0,0,2,0,0,0,2,0])});
  near([...body.geometry.attributes.position.array],[2,0,0,3,0,0,2,1,0]);
  const next=exportCloneInWorld(r.group),nextBody=meshes(next).find(m=>m.userData.kaminosDynamicGeometry);
  near([...nextBody.geometry.attributes.position.array],[3,0,0,5,0,0,3,2,0]);
  const glb=await new GLTFExporter().parseAsync(next,{binary:true}),loaded=await new GLTFLoader().parseAsync(glb,'');
  const roundtrip=meshes(loaded.scene);assert.equal(roundtrip.length,1,'bone editor markers must not leak into authored geometry');
  near([...roundtrip[0].geometry.attributes.position.array],[3,0,0,5,0,0,3,2,0]);
  loaded.scene.updateMatrixWorld(true);next.updateMatrixWorld(true);near(roundtrip[0].matrixWorld.elements,nextBody.matrixWorld.elements);
  r.dispose();near([...nextBody.geometry.attributes.position.array],[3,0,0,5,0,0,3,2,0]);
  assert.throws(()=>exportCloneInWorld(r.group),/disposed/,'a disposed runtime cannot publish stale geometry');
 }finally{r.dispose();}
});
