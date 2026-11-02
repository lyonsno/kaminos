// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFireShadowCasters,KILN_CASTER_SOURCE,loadFireCaster} from '../fire-shadow-casters.mjs';
import {renderFireShadowBatch} from '../fire-light-field-shadow.mjs';
const scene=new THREE.Scene(),root=new THREE.Group(),hero=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({side:THREE.DoubleSide}));
root.userData.kaminosSceneObject={source:`/api/read?root=generated-meshes&path=${KILN_CASTER_SOURCE}.glb`};
hero.castShadow=true;root.add(hero);scene.add(root);root.position.set(2,3,4);root.scale.set(2,3,4);
const proxy=new THREE.Group(),small=new THREE.Mesh(new THREE.TetrahedronGeometry(),new THREE.MeshStandardMaterial());
small.castShadow=true;proxy.add(small);proxy.rotation.x=-Math.PI/2;proxy.updateMatrix();
let loads=0,release;
const casters=createFireShadowCasters({scene,load:async()=>{loads++;return proxy;}});
assert.equal(casters.debugState().level,'original');
await casters.setLevel('10k');assert.equal(loads,1);
const seen=[];
renderFireShadowBatch({scene,casterScene:casters,shadows:Array.from({length:4},()=>({render(p){
  assert.equal(root.visible,false);assert(!p.casters.includes(hero));assert.equal(p.casters[0].geometry,small.geometry);
  assert.equal(p.triangleCount,4);assert.equal(p.casters[0].material.side,THREE.DoubleSide);
  const expected=root.matrixWorld.clone().multiply(proxy.matrix).multiply(small.matrix);
  assert.deepEqual(p.casters[0].matrixWorld.elements,expected.elements,'asset node rotation and nonuniform world placement compose once');seen.push(p);
}}))});
assert.equal(seen.length,4);assert(seen.every(p=>p===seen[0]));
assert.equal(root.visible,true);assert.equal(proxy.parent,null);assert.deepEqual(scene.children,[root]);assert.equal(hero.geometry.attributes.position.count,24,'beauty geometry unchanged');
assert.throws(()=>casters.withCapture(()=>{throw Error('failed face');}),/failed face/);
assert.equal(root.visible,true);assert.equal(proxy.parent,null);
root.visible=false;casters.withCapture(()=>assert.equal(proxy.parent,null));root.visible=true;
casters.withCapture(()=>{});assert.equal(casters.debugState().captureTriangles,4);
await casters.setLevel('5k');assert.equal(casters.debugState().captureTriangles,0,'new choice cannot report old capture work as current');assert.equal(casters.debugState().targets,0);
await casters.setLevel('original');renderFireShadowBatch({scene,casterScene:casters,shadows:[{render(p){assert.deepEqual(p.casters,[hero]);}}]});
await assert.rejects(casters.setLevel('500'),/caster level/);
await casters.setLevel('5k');assert.equal(loads,2);
for(const kind of ['position','index']){
  const original=kind==='position'?hero.geometry.attributes.position:hero.geometry.index;
  const replacement=original.clone();
  while(replacement.version<original.version)replacement.needsUpdate=true;
  if(kind==='position')hero.geometry.setAttribute(kind,replacement);else hero.geometry.setIndex(replacement);
  assert.throws(()=>casters.withCapture(()=>{}),/source geometry changed/,`${kind} replacement at equal revision invalidates`);
  if(kind==='position')hero.geometry.setAttribute(kind,original);else hero.geometry.setIndex(original);
}
hero.geometry.attributes.position.needsUpdate=true;
assert.throws(()=>casters.withCapture(()=>{}),/source geometry changed/);assert.equal(root.visible,true);
await casters.setLevel('original');casters.dispose();assert.equal(proxy.parent,null);
const pending=createFireShadowCasters({scene,load:()=>new Promise(r=>release=r)});
const old=pending.setLevel('10k');await Promise.resolve();await pending.setLevel('original');release(proxy);await old;
assert.equal(pending.debugState().level,'original','late load must not reactivate retired choice');pending.dispose();
const fetchBefore=globalThis.fetch;
try{
  globalThis.fetch=async()=>new Response('',{status:404});await assert.rejects(loadFireCaster('5k'),/HTTP 404/);
  globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]));await assert.rejects(loadFireCaster('5k'),/content identity mismatch/);
}finally{globalThis.fetch=fetchBefore;}

// GI proxy and procedural annular burner stunt-double integration at default 'original' level
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BURNER_DEFAULTS,createAnnularBurner} from '../annular-burner.mjs';
import {createSurfelObject} from '../trellis-surfels.mjs';
{
  const giScene=new THREE.Scene();
  const meshRoot=new THREE.Group(),meshHero=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({side:THREE.DoubleSide}));
  meshHero.castShadow=true;meshRoot.add(meshHero);meshRoot.position.set(-2,1,3);meshRoot.scale.set(1.5,2,0.5);giScene.add(meshRoot);
  // Proxy returned by GLTFLoader has castShadow=false by default; fire-shadow-casters must enable castShadow on its clone.
  const proxy1k=new THREE.Group(),proxyMesh1k=new THREE.Mesh(new THREE.TetrahedronGeometry(),new THREE.MeshStandardMaterial());
  proxy1k.rotation.x=-Math.PI/2;proxy1k.updateMatrix();proxy1k.matrixAutoUpdate=false;proxy1k.add(proxyMesh1k);
  const proxy500=new THREE.Group(),proxyMesh500=new THREE.Mesh(new THREE.OctahedronGeometry(),new THREE.MeshStandardMaterial());
  proxy500.add(proxyMesh500);
  const handles=new Map([[meshRoot,{
    state:'loaded',representation:'mesh',proxyRoot:proxy1k,
    effective:{sha:'1'.repeat(64),faces:4,withinBudget:true},
    error:{reference:{kind:'hero',sha256:'0'.repeat(64)},relative:{p95:0.0012,max:0.004,mean:0.0005}},
    placement:s=>new THREE.Matrix4().copy(s.matrixWorld).invert().multiply(meshRoot.updateWorldMatrix(true,false)??meshRoot.matrixWorld),
  }]]);
  const consumers=new Set();
  const giProxies={
    handleFor:r=>handles.get(r)??null,
    registerConsumer(name){consumers.add(name);return ()=>consumers.delete(name);},
  };
  const giCasters=createFireShadowCasters({scene:giScene,giProxies});
  assert.deepEqual([...consumers],['fire-shadow-casters'],'registers as a GI proxy consumer while enabled');
  giCasters.setEnabled(false);assert.deepEqual([...consumers],[],'disabling surface lighting releases GI proxy consumer');
  giCasters.setEnabled(true);assert.deepEqual([...consumers],['fire-shadow-casters']);

  renderFireShadowBatch({scene:giScene,casterScene:giCasters,shadows:[{render(p){
    assert.equal(meshRoot.visible,false);
    assert.equal(p.casters.length,1);
    assert.equal(p.casters[0].geometry,proxyMesh1k.geometry);
    assert.equal(p.casters[0].material.side,THREE.DoubleSide);
    assert.equal(p.triangleCount,4);
    const expected=meshRoot.matrixWorld.clone().multiply(proxy1k.matrix).multiply(proxyMesh1k.matrix);
    assert.deepEqual(p.casters[0].matrixWorld.elements,expected.elements);
  }}]});
  assert.equal(meshRoot.visible,true);
  assert.equal(proxy1k.parent,null,'registered proxyRoot never enters the scene graph');
  assert.equal(proxyMesh1k.castShadow,false,'original proxyRoot mesh is not mutated');
  assert.equal(giCasters.debugState().targets,1);
  assert.equal(giCasters.debugState().originalTriangles,12);
  assert.equal(giCasters.debugState().captureTriangles,4);
  assert.equal(giCasters.debugState().errorMeasured,true);

  // Switching the object's GI proxy tier updates the shadow caster on the next capture
  handles.set(meshRoot,{...handles.get(meshRoot),proxyRoot:proxy500,effective:{sha:'2'.repeat(64),faces:8,withinBudget:true}});
  renderFireShadowBatch({scene:giScene,casterScene:giCasters,shadows:[{render(p){
    assert.equal(p.casters[0].geometry,proxyMesh500.geometry);
    assert.equal(p.triangleCount,8);
  }}]});
  assert.equal(giCasters.debugState().captureTriangles,8);

  // Disabling the object's GI proxy restores the detailed mesh for shadow capture
  handles.set(meshRoot,{state:'disabled',proxyRoot:null});
  renderFireShadowBatch({scene:giScene,casterScene:giCasters,shadows:[{render(p){
    assert.deepEqual(p.casters,[meshHero]);
    assert.equal(p.triangleCount,12);
  }}]});
  assert.equal(giCasters.debugState().targets,0);

  // Surfel scene object with a loaded GI proxy casts shadows via its static mesh proxy
  const surfelHolder=new THREE.Group();
  const surfelRoot=createSurfelObject(THREE,{
    resolution:16,radiusVoxels:1.5,count:2,
    cells:new Uint32Array([1|(2<<10)|(3<<20),4|(5<<10)|(6<<20)]),
    offsets:new Int8Array(6),normals:new Int8Array([0,0,127,0,0,127]),
    color:new Uint8Array([200,100,50,200,100,50]),metalRough:new Uint8Array([0,200,0,200]),
  },{levels:[1]});
  surfelHolder.add(surfelRoot);giScene.add(surfelHolder);
  handles.set(surfelHolder,{
    state:'loaded',representation:'surfels',proxyRoot:proxy1k,
    effective:{sha:'1'.repeat(64),faces:4,withinBudget:true},
    error:{reference:{kind:'hero',sha256:'0'.repeat(64)},relative:{p95:0.002}},
    placement:s=>new THREE.Matrix4().copy(s.matrixWorld).invert().multiply(surfelHolder.updateWorldMatrix(true,false)??surfelHolder.matrixWorld),
  });
  renderFireShadowBatch({scene:giScene,casterScene:giCasters,shadows:[{render(p){
    assert.equal(surfelHolder.visible,false);
    assert.equal(p.casters.length,2,'detailed meshHero + surfel proxy1k');
    assert.ok(p.casters.some(c=>c.geometry===proxyMesh1k.geometry));
  }}]});
  assert.equal(surfelHolder.visible,true);
  assert.equal(giCasters.debugState().targets,1);
  assert.equal(giCasters.debugState().originalTriangles,2,'counts the 2 surfel triangles on the active surfel level');
  assert.equal(giCasters.debugState().captureTriangles,4);
  giScene.remove(surfelHolder);

  // Procedural annular burner automatically substitutes its coarse enclosing stand-in caster
  const burner=createAnnularBurner(THREE,mergeGeometries,BURNER_DEFAULTS);
  burner.group.visible=true;burner.group.position.set(0,-0.76,0);giScene.add(burner.group);
  renderFireShadowBatch({scene:giScene,casterScene:giCasters,shadows:[{render(p){
    assert.equal(burner.group.visible,false);
    assert.equal(p.casters.length,2,'meshHero + burner stand-in caster');
    assert.ok(p.triangleCount<12000,`expected <12k triangles with burner stand-in, got ${p.triangleCount}`);
  }}]});
  assert.equal(burner.group.visible,true);
  assert.equal(giCasters.debugState().targets,1);
  assert.equal(giCasters.debugState().originalTriangles,125472);
  assert.ok(giCasters.debugState().captureTriangles<12000);
  burner.dispose();
  giCasters.dispose();
  assert.deepEqual([...consumers],[],'dispose releases GI proxy consumer');
}
console.log('PASS caster-only frame, four fresh captures, restoration, invalidation and late-load ownership');
