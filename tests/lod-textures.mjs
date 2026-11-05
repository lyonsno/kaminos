// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeTrellisPbrGLB} from '../models/trellis2/trellis-material.js';

const mesh={vertices:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),uvs:new Float32Array([0,0,1,0,0,1])};
const textures=size=>({width:size,height:size,alphaMode:'OPAQUE',baseColor:Uint8Array.from({length:size*size*4},(_,i)=>i%4===3?255:(i*13)%256),metallicRoughness:new Uint8Array(size*size*4).fill(255)});

test('texture variants preserve every geometry/UV accessor and use actual mip-chain memory', async()=>{
  const {buildTextureVariants,geometrySignature,textureInfo}=await import('../lod-textures.mjs');
  const base=await encodeTrellisPbrGLB(mesh,{textures:textures(8)});
  const variants=await buildTextureVariants({baseGLB:base,sizes:[8,4,2]});
  assert.deepEqual(variants.map(v=>v.textureSize),[8,4,2]);
  for(const variant of variants){
    assert.equal(await geometrySignature(variant.glb),await geometrySignature(base));
    assert.equal(variant.gpuBytes,textureInfo(variant.glb).gpuBytes);
  }
  assert.equal(variants[1].gpuBytes,2*4*(16+4+1));
});

test('independent texture allocation refines maps at fixed geometry and demotes only for its own memory budget', async()=>{
  const {allocateTextureLods}=await import('../scene-lod-textures.mjs');
  const variants=[{sha256:'low',textureSize:64,gpuBytes:100,relativeTexelSize:1/64},{sha256:'high',textureSize:4096,gpuBytes:1000,relativeTexelSize:1/4096}];
  const candidates=[{id:'wall',variants,pixelsPerUnit:1000,worldDiag:1}];
  assert.equal(allocateTextureLods(candidates).allocations.wall.sha256,'high');
  const low=allocateTextureLods(candidates,{textureBudgetBytes:100});
  assert.equal(low.allocations.wall.sha256,'low');
  assert.equal(low.withinBudget,true);
  assert.equal(low.allocations.wall.demotedByTextureBudget,true);
  assert.equal(allocateTextureLods([{...candidates[0],pixelsPerUnit:1}]).allocations.wall.sha256,'low');
  assert.equal(allocateTextureLods([{...candidates[0],instanceCount:20}]).totalBytes,1000,'repetitions reuse their object texture set');
});

test('texture residency changes maps without replacing geometry and ignores replies after release',async()=>{
  const THREE=await import('../lib/three.core.js');
  const {buildTextureVariants,geometrySignature}=await import('../lod-textures.mjs');
  const {createTextureResidency}=await import('../scene-lod-textures.mjs');
  const base=await encodeTrellisPbrGLB(mesh,{textures:textures(8)}),[variant]=await buildTextureVariants({baseGLB:base,sizes:[4]});
  const makeRoot=()=>{const root=new THREE.Group(),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(mesh.vertices.slice(),3));
    const material=new THREE.MeshStandardMaterial({map:new THREE.Texture({width:8,height:8})});root.add(new THREE.Mesh(geometry,material));return root;};
  const root=makeRoot(),geometry=root.children[0].geometry,original=root.children[0].material.map;
  const residency=createTextureResidency({fetchBytes:async()=>variant.glb,parseGlb:async()=>makeRoot()});
  residency.register(root,{geometry:'base',signature:await geometrySignature(base)});
  residency.request(root,variant,{});await residency.whenIdle();
  assert.equal(root.children[0].geometry,geometry);
  assert.notEqual(root.children[0].material.map,original);
  assert.equal(residency.state(root).displayedSha,variant.sha256);
  residency.release(root);assert.equal(root.children[0].material.map,original);
  let finish;
  const late=createTextureResidency({fetchBytes:()=>new Promise(r=>finish=r),parseGlb:async()=>makeRoot()});
  late.register(root,{geometry:'base',signature:await geometrySignature(base)});late.request(root,variant,{});
  await Promise.resolve();late.release(root);finish(variant.glb);await late.whenIdle();
  assert.equal(root.children[0].material.map,original,'released roots cannot regain an appearance');
  assert.equal(late.state(root),null);
});

test('wrong appearance identity and geometry retain the working maps with a visible failure',async()=>{
  const THREE=await import('../lib/three.core.js');
  const {geometrySignature,buildTextureVariants}=await import('../lod-textures.mjs');
  const {createTextureResidency}=await import('../scene-lod-textures.mjs');
  const base=await encodeTrellisPbrGLB(mesh,{textures:textures(8)}),[variant]=await buildTextureVariants({baseGLB:base,sizes:[4]});
  const root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({map:new THREE.Texture({width:8,height:8})})));
  const original=root.children[0].material.map;
  const residency=createTextureResidency({fetchBytes:async()=>base,parseGlb:()=>{throw Error('identity failure must precede parsing');}});
  residency.register(root,{geometry:'base',signature:await geometrySignature(base)});residency.request(root,variant,{});await residency.whenIdle();
  assert.equal(root.children[0].material.map,original);assert.match(residency.state(root).error,/content identity/);
  let requests=0;
  const invalid=createTextureResidency({fetchBytes:()=>{requests++;throw Error('offline');},parseGlb:()=>{throw Error('unused');}});
  invalid.register(root,{geometry:'base',signature:await geometrySignature(base)});const catalog={};invalid.request(root,variant,catalog);await invalid.whenIdle();
  invalid.request(root,variant,catalog);await invalid.whenIdle();assert.equal(requests,1,'failed endpoints do not create per-frame request loops');
  assert.match(invalid.state(root).error,/offline/);
});
