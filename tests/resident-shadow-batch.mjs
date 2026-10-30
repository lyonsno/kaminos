// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {bindResidentLightCoverage} from '../scene-resident-coverage.mjs';
import {renderFireShadowBatch,renderFireShadowCube} from '../fire-light-field-shadow.mjs';

for(const fail of [false,true]){
  const scene=new THREE.Scene(),source=new THREE.MeshStandardNodeMaterial({alphaTest:.5,side:THREE.DoubleSide});
  source.opacityNode=THREE.TSL.float(1);
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),source);mesh.castShadow=true;scene.add(mesh);
  const unbind=bindResidentLightCoverage(mesh,{owner:mesh,read:()=>({texture:{},device:{},dimensions:[1,1,1],initial:new Uint32Array([1]),bounds:new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5))})});
  let hook=null,draws=0,resets=0,restores=0;
  const original=new THREE.NodeMaterial();scene.overrideMaterial=original;
  const radial=new THREE.NodeMaterial();radial.fragmentNode=THREE.TSL.vec4(1);
  const coverageMaterials=new Map();
  const renderer={lighting:{enabled:true},setClearColor(){},setRenderObjectFunction(fn){hook=fn;},renderObject(){
    draws++;
    assert.notEqual(scene.overrideMaterial,radial,'Batched radial capture must retain resident material cutout');
    assert.equal(scene.overrideMaterial,coverageMaterials.get(source)?.material);
    assert.equal(scene.overrideMaterial.side,source.side);
    if(fail)throw Error('face failure');
  }};
  const RendererUtils={resetRendererAndSceneState(){resets++;return {material:scene.overrideMaterial,hook};},restoreRendererAndSceneState(r,s,state){restores++;s.overrideMaterial=state.material;hook=state.hook;}};
  const cubeCamera={update(){assert.equal(renderer.lighting.enabled,false,'radial distance capture must ignore unrelated scene illumination');hook(mesh,null,null,null,source);}};
  const shadows=[0,1].map(()=>({batchRenderer:renderer,batchScene:scene,render(batch){renderFireShadowCube({renderer,scene,cubeCamera,material:radial,far:10,batch,coverageMaterials,RendererUtils});}}));
  const run=()=>renderFireShadowBatch({scene,shadows,RendererUtils});
  if(fail)assert.throws(run,/face failure/);else run();
  assert.equal(renderer.lighting.enabled,true,'restore illumination for beauty draw');assert.equal(draws,fail?1:2);assert.equal(resets,1);assert.equal(restores,1);
  assert.equal(scene.overrideMaterial,original);assert.equal(hook,null);
  assert.equal(mesh.frustumCulled,true);assert.equal(scene.matrixWorldAutoUpdate,true);
  unbind();for(const row of coverageMaterials.values())row.material.dispose();
  mesh.geometry.dispose();source.dispose();radial.dispose();original.dispose();
}
console.log('PASS resident cutout survives batched shadow capture and failure restoration');
