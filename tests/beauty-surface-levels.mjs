// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../lib/three.core.js';
import {createGiProxyRegistry} from '../scene-gi-proxies.mjs';
import {createSceneBeautyLodController} from '../scene-lod-budget.mjs';
import {prepareLowTiers} from '../mesh-lod-ladder.mjs';
import {prepareGenerationLevels} from '../lod-generation-levels.mjs';
import {encodeTrellisPbrGLB} from '../models/trellis2/trellis-material.js';

const hero='a'.repeat(64), beauty='b'.repeat(64), shared='c'.repeat(64);
const levels=[{sha256:beauty,faces:200,purpose:'beauty',closed:false,error:{relative:{p95:0,max:0,mean:0}}},
  {sha256:shared,faces:12,closed:true,error:{relative:{p95:.2,max:.2,mean:.2}}}];
const rootFor=()=>{const root=new THREE.Group();root.userData.kaminosSceneObject={id:'kiln',source:`/api/read?root=generated-meshes&path=${hero}.glb`};return root;};

test('beauty-only levels stay outside the shared proxy catalog, including shadow opt-out refresh',async()=>{
  let fail=false;
  const registry=createGiProxyRegistry({THREE,fetchJson:async()=>{
    if(fail)throw Error('offline');return {source:hero,levels:[levels[1]],beautyLevels:levels,choice:null};
  },parseGlb:async()=>new THREE.Group()});
  const root=rootFor();const h=await registry.attach(root);
  assert.deepEqual(h.levels.map(l=>l.sha),[shared]);
  assert.deepEqual(h.beautyLevels.map(l=>l.sha),[beauty,shared]);
  await registry.disable(root);fail=true;await registry.disable(root);
  assert.deepEqual(registry.get(root).beautyLevels.map(l=>l.sha),[beauty,shared]);
  registry.clear();
});

test('automatic beauty loads its own intermediate while collision uses the shared catalog',async()=>{
  const scene=new THREE.Scene(),root=rootFor();root.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1,10,10,10),new THREE.MeshStandardMaterial()));scene.add(root);
  const loads=[],handle={root,levels:[{...levels[1],sha:shared,error:{relative:{p95:0,max:0,mean:0}}}],beautyLevels:levels.map(l=>({...l,sha:l.sha256}))};
  const controller=createSceneBeautyLodController({THREE,scene,giProxies:{list:()=>[handle],get:()=>handle},
    loadLevel:async level=>{loads.push(level.sha);return new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));},
    settings:{faceBudget:300,texelWeight:0}});
  const camera=new THREE.PerspectiveCamera(50,1,.01,100);camera.position.z=3;camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  try{
    controller.update(camera);await controller.whenIdle();const state=controller.update(camera);
    assert.equal(state.objects[0].displayedTier,beauty);
    assert.equal(state.totalFaces,200);assert.equal(state.withinBudget,true);
    await controller.prepareCollision([root],{cellSize:1});
    assert.equal(controller.resolveCollisionRung(root,{cellSize:1}).sha,shared);
    assert.ok(loads.includes(beauty)&&loads.includes(shared));
  }finally{controller.dispose();}
});

test('beauty geometry reduces the existing surface without calling the closed remesher',async()=>{
  const geometry=new THREE.BoxGeometry(1,1,1,3,3,3),vertices=geometry.attributes.position.array.slice(),triangles=Uint32Array.from(geometry.index.array);
  const before=vertices.slice();let baked=0;
  const tiers=await prepareLowTiers({mesh:{vertices,triangles},targets:[50],purpose:'beauty',compact:false,
    closestPoint(){assert.fail('beauty simplification must not rebuild/project a closed grid');},
    finish:async mesh=>{baked++;return {glb:new ArrayBuffer(8)};}});
  assert.equal(baked,1);assert.equal(tiers[0].route,'trellis-simplify+pairing');assert.equal(tiers[0].purpose,'beauty');
  assert.ok(tiers[0].faces>0&&tiers[0].faces<=55);assert.equal(tiers[0].textureSize,2048);
  assert.equal(tiers[0].grid,undefined);assert.deepEqual(vertices,before);
});

test('generation publishes a requested beauty intermediate with measured source identity and reuses it',async()=>{
  const ExternalThree=await import('three'),{MeshBVH}=await import('three-mesh-bvh');
  const {finishTrellisMesh}=await import('../models/trellis2/trellis-material.js');
  const {createWasmXatlasUnwrapper}=await import('../models/trellis2/wasm-xatlas.js');
  const {NodeTrellisUVWorker}=await import('../models/trellis2/node-uv-worker.mjs');
  const g=new THREE.BoxGeometry(1,1,1,3,3,3);
  const mesh={vertices:g.attributes.position.array,triangles:Uint32Array.from(g.index.array),normals:g.attributes.normal.array,uvs:g.attributes.uv.array};
  const textures={width:2,height:2,alphaMode:'OPAQUE',baseColor:new Uint8Array(16).fill(255),metallicRoughness:new Uint8Array(16).fill(127)};
  const heroGLB=await encodeTrellisPbrGLB(mesh,{textures});
  const source=createHash('sha256').update(new Uint8Array(heroGLB)).digest('hex'),registered=[];
  const fetch=async(url,init={})=>{
    const json=value=>new Response(JSON.stringify(value));
    if(!init.method)return json({source,levels:registered});
    if(url.startsWith('/api/ingest-mesh'))return json({sha256:createHash('sha256').update(new Uint8Array(init.body)).digest('hex')});
    const body=JSON.parse(init.body);registered.push(body.level);return json({source,level:body.level});
  };
  const options={source,heroGLB,fetch,THREE:ExternalThree,MeshBVH,targets:[],beautyTargets:[50],normalMaps:false,textureLevels:false,
    textureSizeFor:()=>8,finish:finishTrellisMesh,unwrapMesh:createWasmXatlasUnwrapper(),WorkerClass:NodeTrellisUVWorker};
  const report=await prepareGenerationLevels(options);
  assert.equal(report.phase,'done',report.error?.message);assert.equal(registered.length,1);
  assert.equal(registered[0].purpose,'beauty');assert.equal(registered[0].route,'trellis-simplify+pairing');assert.equal(registered[0].targetFaces,50);
  assert.equal(registered[0].error.reference.sha256,source);
  const replay=await prepareGenerationLevels({...options,completeMissing:true});
  assert.equal(replay.phase,'done',replay.error?.message);assert.equal(registered.length,1,'actual-count drift does not rebake the target');
  const skipped=await prepareGenerationLevels({...options,beautyTargets:[1000]});
  assert.equal(skipped.phase,'done',skipped.error?.message);assert.equal(registered.length,1,'source already below target stays the source');
  const completeFetch=async(url,init={})=>!init.method?new Response(JSON.stringify({source,levels:[...registered,
    {sha256:'d'.repeat(64),faces:25000,targetFaces:25000,route:'closed-remesh+projection+trellis-simplify'}]})):fetch(url,init);
  const automatic=await prepareGenerationLevels({...options,fetch:completeFetch,targets:[25000],beautyTargets:null,completeMissing:true});
  assert.equal(automatic.phase,'done',automatic.error?.message);
  assert.deepEqual(automatic.beauty.skippedTargets,[100000],'ordinary default preparation checks the intermediate even when closed targets exist');
});
