// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';
import {createSceneBurnBody,originalBurnMaterial} from '../scene-burn-body.mjs';
import {cloneSceneRadianceMaterial} from '../scene-radiance.mjs';
import {createRepetitionView} from '../scene-repetition.mjs';
import {createSceneMaterials} from '../scene-material-recipes.mjs';
import {sceneMaterialPrograms} from '../scene-material-programs.mjs';
import {createTextureResidency} from '../scene-lod-textures.mjs';
import {encodeTrellisPbrGLB} from '../models/trellis2/trellis-material.js';
import {buildTextureVariants,geometrySignature} from '../lod-textures.mjs';
const library={fromMaterial:source=>new THREE.MeshStandardNodeMaterial().copy(source)};
async function fixture(){
  const geometry=new THREE.BoxGeometry(1,.5,.5),surface={vertices:geometry.attributes.position.array,uvs:geometry.attributes.uv.array,triangles:Uint32Array.from(geometry.index.array)};
  const rgba=new Uint8Array(8*8*4).fill(255),base=await encodeTrellisPbrGLB(surface,{textures:{width:8,height:8,baseColor:rgba,metallicRoughness:rgba,alphaMode:'OPAQUE'}});
  const variants=await buildTextureVariants({baseGLB:base,sizes:[4,2]});
  const makeRoot=()=>{const root=new THREE.Group();root.add(new THREE.Mesh(geometry.clone(),new THREE.MeshStandardMaterial({map:new THREE.Texture({width:8,height:8})})));return root;};
  const root=makeRoot(),bySha=new Map(variants.map(v=>[v.sha256,v]));
  const residency=createTextureResidency({fetchBytes:async url=>bySha.get(url.match(/([a-f0-9]{64})\.glb/)[1]).glb,parseGlb:async()=>makeRoot()});
  residency.register(root,{geometry:'base',signature:await geometrySignature(base)});return {root,residency,variants};
}
function rendererStub(){
  globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,COPY_SRC:4,UNIFORM:64,MAP_READ:1};globalThis.GPUTextureUsage={STORAGE_BINDING:8,TEXTURE_BINDING:4,COPY_DST:2};
  const resource=spec=>({...spec,createView:()=>({}),destroy(){}}),device={limits:{maxTextureDimension2D:2048},createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBuffer:resource,createTexture:resource,createBindGroup:x=>x,queue:{writeBuffer(){},writeTexture(){}}};
  return {backend:{device,get:()=>({})},library};
}

test('selected maps survive actual burn-body disposal through an outer lighting clone',async()=>{
  const {root,residency,variants}=await fixture(),scene=new THREE.Scene();scene.add(root);const mesh=root.children[0];
  residency.request(root,variants[0],{});await residency.whenIdle();
  const source=originalBurnMaterial(mesh.material),frameCallbacks=new Set();
  const body=await createSceneBurnBody({entry:{id:'burn-owner',object:root,burnable:{enabled:true,material:'wood',appearance:{profile:'composed',glow:1}}},renderer:rendererStub(),scene,
    ground:()=>({center:[0,0,0],height:-1,radius:5}),onFrame:fn=>{frameCallbacks.add(fn);return()=>frameCallbacks.delete(fn);}});
  mesh.material=cloneSceneRadianceMaterial(library,mesh.material);
  residency.request(root,variants[1],{});await residency.whenIdle();const selected=mesh.material.map;
  assert.equal(residency.state(root).displayedSha,variants[1].sha256);
  body.dispose();
  assert.equal(mesh.material,source);
  assert.equal(mesh.material.map,selected,'burn teardown must restore the currently selected maps, not the captured prior map');
  residency.request(root,variants[1],{});await residency.whenIdle();assert.equal(mesh.material.map,selected);
  assert.equal(frameCallbacks.size,0);residency.dispose();
});

test('ordinary repetition copies keep selected maps after actual lighting installation',async()=>{
  const {root,residency,variants}=await fixture(),view=createRepetitionView();
  const settings={mode:'line',count:2,step:[2,0,0]},frame={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
  residency.request(root,variants[0],{});await residency.whenIdle();view.sync(root,settings,frame);
  const source=fs.readFileSync(new URL('../scene-hybrid-radiance.mjs',import.meta.url),'utf8'),start=source.indexOf('  function installMaterials('),end=source.indexOf('  function releaseProxyMaterials',start);
  assert.ok(start>=0&&end>start);
  const originals=new Map();
  const install=vm.runInNewContext('('+source.slice(start,end).trim()+')',{scene:root,originals,cloneSceneRadianceMaterial,renderer:{library},THREE,irradiance:THREE.TSL.vec3(0),surfaceLighting:null,prepareSurfaceSampling:()=>{}});
  install(root);view.sync(root,settings,frame);install(root);
  const hero=root.children.find(n=>n.isMesh),copy=root.children.find(n=>n.userData.kaminosRepetitionCopy).children[0];
  const installed=copy.material;assert.notEqual(installed,hero.material);
  view.sync(root,settings,frame);
  residency.request(root,variants[1],{});await residency.whenIdle();view.sync(root,settings,frame);
  const currentCopy=root.children.find(n=>n.userData.kaminosRepetitionCopy).children[0];
  assert.equal(currentCopy.material.map,hero.material.map,'lighting clones must share the newly selected map');
  assert.equal(currentCopy.material,installed,'appearance does not discard lighting adaptation');
  residency.dispose();view.clear(root);
});

for(const implementation of ['asset-surface','standard-surface'])test('texture residency preserves source and '+implementation+' map policy during assignment',async()=>{
 const {root,residency,variants}=await fixture(),base=root.children[0].material;
 const entry={id:'asset',object:root},materials=createSceneMaterials({entries:()=>[entry],definitions:sceneMaterialPrograms});
 const recipe={id:'finish',name:'Finish',implementation,version:1,parameters:{color:'#aa5533',roughness:.23,metalness:.8}};
 try{
  materials.write({recipes:[recipe],bindings:[{objectId:entry.id,slot:'0:0',recipeId:recipe.id}]});
  const authored=root.children[0].material,prior=base.map;
  residency.request(root,variants[0],{});await residency.whenIdle();materials.sync();
  assert.notEqual(base.map,prior,'resident source receives selected maps while a recipe is assigned');
  assert.equal(authored.map,implementation==='asset-surface'?base.map:null,'program map policy survives automatic residency');
  const selected=base.map;
  materials.write({recipes:[recipe],bindings:[]});
  assert.equal(root.children[0].material,base);assert.equal(base.map,selected);
  assert.equal(residency.state(root).displayedSha,variants[0].sha256);
 }finally{materials.clear();residency.dispose();}
});
