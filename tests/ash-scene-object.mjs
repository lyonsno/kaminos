// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSceneRecordOperations as records} from '../scene-record-operations.mjs';

const record=()=>({id:'ash-1',type:'retained-ash',source:'kaminos:retained-ash',label:'Ash',transform:{position:[2,0,-3],rotation:[0,0,0],scale:[1,1,1]},ash:{schema:'kaminos.ash-object.v1',width:3.84,depth:3.84,height:1.6,cellSize:.04,initialDepth:.08,paused:false,emitting:false,rate:.008,spread:.24,sourcePosition:[0,1.15,0],checkpoint:null}});
test('native scene record retains ash setup and evolved state and is reloadable',()=>{
 const raw=record();raw.ash.checkpoint={schema:'kaminos.tiled-ash.v1',values:[.5],steps:17};
 const normalized=records.normalize(raw);
 assert.deepEqual(normalized.ash,raw.ash);
 assert.equal(records.reloadable(normalized),true);
 raw.ash.sourcePosition[0]=99;assert.equal(normalized.ash.sourcePosition[0],0);
});
test('native ash rejects malformed settings instead of silently dropping simulation state',()=>{
 const raw=record();raw.ash.cellSize=0;assert.throws(()=>records.normalize(raw),/cell/i);
 const missing=record();delete missing.ash;assert.throws(()=>records.normalize(missing),/ash/i);
});

import {Group,Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {createAshSceneObject,createAshCollisionRecords} from '../ash/scene-object.mjs';
test('ash initialization is once-only; hidden or removed fields do no work; dispose releases once',async()=>{
 let ticks=0,deposits=0,disposed=0,restores=0;
 const patch={root:new Group(),syncScene(){},deposit:async()=>{deposits++;},step(){ticks++;},dispose(){disposed++;},read:()=>({steps:ticks}),snapshot:async()=>({schema:'kaminos.tiled-ash.v1',steps:ticks}),restore(){restores++;}};
 const object=await createAshSceneObject({record:record(),readObjects:()=>[],createPatch:async()=>patch});
 object.tick(1000);assert.equal(ticks,0);
 await object.initialize();await object.initialize();assert.equal(deposits,1);
 object.tick(1001,{active:false});assert.equal(ticks,0);object.tick(1100);assert.equal(ticks,1);
 object.set({paused:true});object.tick(1200);assert.equal(ticks,1);
 const saved=await object.checkpoint();assert.equal(saved.checkpoint.steps,1);
 object.dispose();object.dispose();object.tick(1300);assert.equal(disposed,1);assert.equal(ticks,1);
 const reloaded=await createAshSceneObject({record:{...record(),ash:saved},readObjects:()=>[],createPatch:async()=>({...patch,root:new Group()})});
 reloaded.tick(1400);assert.equal(ticks,1);await reloaded.initialize();assert.equal(restores,1);assert.equal(deposits,1);reloaded.dispose();
});
test('scene triangles are borrowed in field coordinates; their native transform is unchanged',()=>{
 const root=new Group();root.position.set(2,0,-3);
 const mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial());mesh.position.set(3,1,-2);
 const list=createAshCollisionRecords(root,()=>[{id:'box',type:'procedural-mesh',object:mesh},{id:'self',type:'retained-ash',object:root}]);
 const first=list();assert.equal(first.length,1);assert.deepEqual(first[0].object.matrixWorld.elements.slice(12,15),[1,1,1]);assert.deepEqual(mesh.position.toArray(),[3,1,-2]);
 mesh.position.x=4;const second=list();assert.equal(second[0].object,first[0].object);assert.deepEqual(second[0].object.matrixWorld.elements.slice(12,15),[2,1,1]);
 mesh.visible=false;assert.equal(list().length,0);mesh.geometry.dispose();mesh.material.dispose();
});
test('ash refuses a singular field transform before GPU construction',()=>{
 const raw=record();raw.transform.scale=[1,0,1];assert.throws(()=>records.normalize(raw),/scale|transform/i);
});

test('corrected scene collision permits checkpoint without losing retained or falling state',async()=>{
 let scene=[],steps=0,collisions;const state={schema:'kaminos.tiled-ash.v1',values:[.25,.75],falling:{particles:[1,2,3,.5]}};
 const object=await createAshSceneObject({record:{...record(),ash:{...record().ash,initialDepth:0}},readObjects:()=>scene,createPatch:async options=>{collisions=options.sceneRecords;return {root:new Group(),syncScene:()=>collisions(),step(){collisions();steps++;},read:()=>({steps}),snapshot:async()=>structuredClone(state),dispose(){}};}});
 await object.initialize();object.tick(1000);assert.equal(steps,1);
 const mesh=new Mesh(new BoxGeometry(),new MeshBasicMaterial());mesh.isSkinnedMesh=true;
 scene=[{id:'bad',label:'rig',type:'glb',object:mesh}];object.tick(1100);assert.match(object.read().failure,/rigid triangles/);
 await assert.rejects(object.checkpoint(),/rigid triangles/);
 scene=[];
 object.set({paused:true}); // a refusal must not lock out authoring or require deletion
 const saved=await object.checkpoint();assert.deepEqual(saved.checkpoint,state);assert.equal(object.read().failure,null);
 object.set({paused:false});object.tick(1200);assert.equal(steps,2);
 object.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

test('ash payload synchronization preserves the current authored name',async()=>{
 const {createSceneRecordOperations}=await import('../scene-record-operations.mjs');
 const object=await createAshSceneObject({record:record(),readObjects:()=>[],createPatch:async()=>({root:new Group(),syncScene(){},deposit:async()=>{},read:()=>({}),snapshot:async()=>({schema:'kaminos.tiled-ash.v1',values:[.4]}),dispose(){}})});
 await object.initialize();const entry={...record(),object:object.root,label:'Kiln aftermath'};
 object.root.userData.kaminosSceneObject.label=entry.label;
 object.set({rate:.002});entry.ash=await object.checkpoint();
 const serializer=createSceneRecordOperations({readers:{transform:()=>record().transform,materials:()=>null}});
 assert.equal(serializer.serialize(entry).label,'Kiln aftermath');object.dispose();
});

test('independent ash sources round-trip their field association and settings',()=>{
 const source={id:'source-1',type:'ash-source',source:'kaminos:ash-source',label:'Ash source',transform:record().transform,ashSource:{fieldId:'ash-1',enabled:true,rate:.003,spread:.12}};
 assert.deepEqual(records.normalize(source).ashSource,source.ashSource);
 assert.equal(records.reloadable(source),true);
 assert.throws(()=>records.normalize({...source,ashSource:{...source.ashSource,rate:-1}}),/source/);
});

test('field advances once with all live independent sources and retains material when removed',async()=>{
 let sources=[{position:[1,1,0],rate:.003,spread:.1},{position:[-1,1,0],rate:.006,spread:.2}],received=[],deposits=0;
 const object=await createAshSceneObject({record:record(),readObjects:()=>[],readSources:()=>sources,createPatch:async()=>({root:new Group(),syncScene(){},deposit:async()=>{deposits++;},step(c,s){received.push(s);},read:()=>({steps:received.length}),dispose(){}})});
 await object.initialize();object.tick(1000);assert.equal(received.length,1);assert.deepEqual(received[0].sources,sources);
 sources=[];object.tick(1100);assert.deepEqual(received[1].sources,[]);assert.equal(deposits,1);object.dispose();
});

import {sourceInField} from '../ash/source-object.mjs';
test('world-space source follows transforms and refuses out-of-field coverage without clamping',()=>{
 const root=new Group();root.position.set(2,0,0);root.scale.setScalar(2);
 const object=new Group();object.position.set(2,1,0);object.userData.kaminosSceneObject={ashSource:{fieldId:'f',enabled:true,rate:.02,spread:.2}};
 const field={root,read:()=>({settings:{width:2,depth:2}})};
 const inside=sourceInField({object},field);assert.deepEqual(inside.position,[0,.5,0]);assert.equal(inside.spread,.1);assert.equal(inside.rate,.02);
 object.position.x=10;const outside=sourceInField({object},field);assert.equal(outside.inside,false);assert.equal(outside.rate,0);assert.equal(outside.position[0],4);
});

import {sourceSettings} from '../ash/fall-plan.mjs';
test('field fallout remains valid on one-cell and two-cell authored extents',async()=>{
 for(const [width,depth] of [[.5,.5],[1,1],[.5,3],[3,1]]){
  let emitted;
  const raw=record();Object.assign(raw.ash,{width,depth,cellSize:.5,initialDepth:0,fallout:true});
  const object=await createAshSceneObject({record:raw,readObjects:()=>[],createPatch:async()=>({root:new Group(),syncScene(){},step(c,s){emitted=s.sources.map(sourceSettings);},read:()=>({}),dispose(){}})});
  await object.initialize();assert.equal(object.tick(1000),true,object.read().failure);
  assert.equal(emitted.length,1);assert.deepEqual(emitted[0].halfExtents,[width/2,depth/2]);
  assert.equal(object.tick(1100),true);object.dispose();
 }
});

test('native sliding edits persist and reach the existing field owner without replacing its state',async()=>{
 const changes=[];let constructs=0;
 const object=await createAshSceneObject({record:record(),readObjects:()=>[],createPatch:async()=>{constructs++;return {root:new Group(),syncScene(){},deposit:async()=>{},setSliding:s=>changes.push(s),read:()=>({}),dispose(){}};}});
 await object.initialize();object.set({slideVariation:.8,slideScale:.2});
 assert.deepEqual(changes.at(-1),{variation:.8,scale:.2,release:undefined});assert.equal(constructs,1);
 assert.equal(records.normalize({...record(),ash:object.read().settings}).ash.slideVariation,.8);
 assert.throws(()=>object.set({slideVariation:2}),/variation/);assert.equal(object.read().settings.slideVariation,.8);object.dispose();
});

test('regrid keeps field identity and sources, clears material, and rejects failed replacement atomically',async()=>{
 const patches=[],sources=[{position:[0,1,0],rate:.01,spread:.1}];let fail=false;
 const object=await createAshSceneObject({record:record(),readObjects:()=>[],readSources:()=>sources,createPatch:async options=>{
  if(fail)throw Error('allocation refused');
  const p={root:new Group(),options,disposed:0,deposits:0,received:[],syncScene(){},deposit:async()=>{p.deposits++;},step(c,s){p.received.push(s);},read:()=>({steps:p.received.length}),dispose(){p.disposed++;p.root.removeFromParent();}};patches.push(p);return p;
 }});
 await object.initialize();const root=object.root;
 await object.regrid(.02);
 assert.equal(object.root,root);assert.equal(object.read().id,'ash-1');assert.equal(object.read().settings.cellSize,.02);
 assert.equal(patches[0].disposed,1);assert.equal(patches[1].deposits,0);assert.equal(object.read().settings.checkpoint,undefined);
 object.tick(1000);assert.deepEqual(patches[1].received[0].sources,sources);
 fail=true;await assert.rejects(object.regrid(.01),/allocation refused/);
 assert.equal(object.read().settings.cellSize,.02);assert.equal(patches[1].disposed,0);assert.equal(object.read().busy,false);
 object.dispose();assert.equal(patches[1].disposed,1);
});

test('deletion during async regrid releases both old and candidate fields',async()=>{
 let resolve,calls=0;const patches=[];
 const create=()=>{const p={root:new Group(),syncScene(){},deposit:async()=>{},read:()=>({}),disposed:0,dispose(){p.disposed++;p.root.removeFromParent();}};patches.push(p);return p;};
 const object=await createAshSceneObject({record:record(),readObjects:()=>[],createPatch:async()=>++calls===1?create():new Promise(r=>resolve=r)});
 await object.initialize();const pending=object.regrid(.02);object.dispose();resolve(create());
 await assert.rejects(pending,/disposed/i);assert.deepEqual(patches.map(p=>p.disposed),[1,1]);
});

test('collision records isolate ash from viewport camera beauty LOD proxies',()=>{
 const ashRoot=new Group();
 const entryRoot=new Group();
 const heroGeom=new BoxGeometry(1,2,1);
 const heroMesh=new Mesh(heroGeom,new MeshBasicMaterial());
 entryRoot.add(heroMesh);
 const beautyGeom=new BoxGeometry(.5,.5,.5);
 const beautyMesh=new Mesh(beautyGeom,new MeshBasicMaterial());
 const wrapper=new Group();
 wrapper.userData.kaminosBeautyLodProxy=true;
 wrapper.add(beautyMesh);
 const mountBeauty=()=>{
  heroMesh.visible=false;
  if(wrapper.parent!==entryRoot)entryRoot.add(wrapper);
  entryRoot.userData.kaminosBeautyLodRestore=()=>{
   heroMesh.visible=true;
   if(wrapper.parent===entryRoot)entryRoot.remove(wrapper);
   delete entryRoot.userData.kaminosBeautyLodRestore;
   return mountBeauty;
  };
 };
 mountBeauty();
 const list=createAshCollisionRecords(ashRoot,()=>[{id:'kiln',type:'glb',object:entryRoot}]);
 const out=list();
 assert.equal(out.length,1);
 assert.equal(out[0].object.geometry,heroGeom,'ash collision must read hero or ash-selected geometry, never camera beauty proxy');
 assert.equal(heroMesh.visible,false,'camera beauty visibility state must be restored after collision inspection');
 assert.equal(wrapper.parent,entryRoot,'camera beauty wrapper must remain mounted for viewport after inspection');
 heroGeom.dispose();beautyGeom.dispose();
});

import {selectAshCollisionLod} from '../ash/scene-object.mjs';
const kilnLevels=[
 {faces:500,sha:'a'.repeat(64),closed:false,error:{diagonal:2.022905,relative:{p95:0.017971,max:0.135345},sourceToLevel:{p95:0.036353,max:0.273791},levelToSource:{p95:0.025811,max:0.151652}}},
 {faces:1000,sha:'b'.repeat(64),closed:false,error:{diagonal:2.022905,relative:{p95:0.014104,max:0.135345},sourceToLevel:{p95:0.028532,max:0.273791},levelToSource:{p95:0.021121,max:0.165143}}},
 {faces:5000,sha:'c'.repeat(64),closed:false,error:{diagonal:2.022905,relative:{p95:0.013183,max:0.089763},sourceToLevel:{p95:0.011002,max:0.171482},levelToSource:{p95:0.013183,max:0.181582}}},
 {faces:10000,sha:'d'.repeat(64),closed:false,error:{diagonal:2.022905,relative:{p95:0.010283,max:0.075123},sourceToLevel:{p95:0.008512,max:0.138112},levelToSource:{p95:0.010283,max:0.151988}}},
 {faces:25000,sha:'e'.repeat(64),closed:false,error:{diagonal:2.022905,relative:{p95:0.004917,max:0.066353},sourceToLevel:{p95:0.003999,max:0.134226},levelToSource:{p95:0.004917,max:0.134226}}},
];
const beamLevels=[
 {faces:500,sha:'1'.repeat(64),closed:true,error:{diagonal:2.022871,relative:{p95:0.00505,max:0.023879},sourceToLevel:{p95:0.010215,max:0.036301},levelToSource:{p95:0.007909,max:0.048304}}},
 {faces:1000,sha:'2'.repeat(64),closed:true,error:{diagonal:2.022871,relative:{p95:0.002976,max:0.017014},sourceToLevel:{p95:0.00602,max:0.034418},levelToSource:{p95:0.004521,max:0.031521}}},
];
test('selectAshCollisionLod chooses stunt-double tiers by cell width while rejecting pipe-dropping or topology-sealing tiers',()=>{
 const at04=selectAshCollisionLod(kilnLevels,{cellSize:.04,worldDiag:2.023,heroFaces:368266});
 assert.equal(at04.faces,5000,'0.04m ash selects 5000-face kiln and rejects pipe-dropping 500/1000 tiers');
 const scaledUp=selectAshCollisionLod(kilnLevels,{cellSize:.04,worldDiag:8.0,heroFaces:368266});
 assert.equal(scaledUp.faces,5000,'enlarging kiln keeps resident stunt-double tier instead of falling back to 368k hero');
 const at02=selectAshCollisionLod(kilnLevels,{cellSize:.02,worldDiag:2.023,heroFaces:368266});
 assert.equal(at02.faces,25000,'0.02m fine ash selects finer 25000-face kiln tier');
 const scaledDown02=selectAshCollisionLod(kilnLevels,{cellSize:.02,worldDiag:0.25,heroFaces:368266});
 assert.equal(scaledDown02.faces,25000,'shrinking kiln at 0.02m also keeps 25000-face tier without mid-drag tier switches');
 const beam=selectAshCollisionLod(beamLevels,{cellSize:.04,worldDiag:2.023,heroFaces:52936});
 assert.equal(beam.faces,500,'prismatic beam selects coarsest 500-face tier');
 const sealed=[
  {faces:500,sha:'f'.repeat(64),closed:true,error:beamLevels[0].error},
  {faces:5000,sha:'9'.repeat(64),closed:false,error:kilnLevels[2].error},
 ];
 assert.equal(selectAshCollisionLod(sealed,{cellSize:.04,worldDiag:2.023,heroFaces:100000}).faces,5000,'rejects coarse tier that seals an open mesh');
});

import * as THREE from '../lib/three.core.js';
import {createGiProxyRegistry} from '../scene-gi-proxies.mjs';
import {createSceneBeautyLodController} from '../scene-lod-budget.mjs';
test('ash scene object prepares and consumes stunt-double collision rungs across initialize, repetition, vertex warp, and regrid',async()=>{
 const heroSha='f'.repeat(64);
 const scene=new Group();
 const kilnRoot=new Group();
 kilnRoot.position.set(1,0,-1);
 kilnRoot.userData.kaminosSceneObject={id:'kiln-1',type:'glb',source:`/api/read?root=generated-meshes&path=${heroSha}.glb`};
 const heroGeom=new BoxGeometry(1,2,1,50,50,50); // 30000 faces > 25000
 const heroMesh=new Mesh(heroGeom,new MeshBasicMaterial());
 kilnRoot.add(heroMesh);
 const repCopy=new Group();
 repCopy.userData.kaminosRepetitionCopy=true;
 repCopy.position.set(2,0,0);
 repCopy.updateMatrix();
 kilnRoot.add(repCopy);
 kilnRoot.userData.kaminosVertexWarp=pos=>{
  const out=new Float32Array(pos.length);
  for(let i=0;i<pos.length;i+=3){out[i]=pos[i]+0.25;out[i+1]=pos[i+1];out[i+2]=pos[i+2];}
  return out;
 };
 kilnRoot.userData.kaminosVertexWarpRevision=1;
 scene.add(kilnRoot);

 const tierGeoms=new Map([
  ['c'.repeat(64),new BoxGeometry(1,2,1,2,2,2)],
  ['e'.repeat(64),new BoxGeometry(1,2,1,4,4,4)],
 ]);
 const levels=kilnLevels.map(l=>({...l,sha256:l.sha,source:`/api/read?root=generated-meshes&path=${l.sha}.glb`}));
 const giProxies=createGiProxyRegistry({
  THREE,
  fetchJson:async()=>({levels,choice:levels[1],withinBudget:true}),
  fetchBytes:async url=>new TextEncoder().encode(url),
  digest:async bytes=>{const u=new TextDecoder().decode(bytes);return /([a-f0-9]{64})\.glb/.exec(u)?.[1]??'';},
  parseGlb:async bytes=>{
   const sha=/([a-f0-9]{64})\.glb/.exec(new TextDecoder().decode(bytes))?.[1];
   const g=(tierGeoms.get(sha)??new BoxGeometry(1,2,1)).clone();
   const root=new Group();root.add(new Mesh(g,new MeshBasicMaterial()));return root;
  },
 });
 giProxies.select(kilnRoot,{faces:1000}); // deliberately in-flight (not awaited yet)
 const lodController=createSceneBeautyLodController({
  THREE,
  scene,
  giProxies,
  fetchBytes:async url=>new TextEncoder().encode(url),
  digest:async bytes=>{const u=new TextDecoder().decode(bytes);return /([a-f0-9]{64})\.glb/.exec(u)?.[1]??'';},
  parseGlb:async bytes=>{
   const sha=/([a-f0-9]{64})\.glb/.exec(new TextDecoder().decode(bytes))?.[1];
   const g=(tierGeoms.get(sha)??new BoxGeometry(1,2,1)).clone();
   const root=new Group();root.add(new Mesh(g,new MeshBasicMaterial()));return root;
  },
 });

 const synced=[];
 const ashObj=await createAshSceneObject({
  record:record(),
  readObjects:()=>[{id:'kiln-1',type:'glb',object:kilnRoot}],
  lodController,
  createPatch:async options=>({
   root:new Group(),
   syncScene(){synced.push(options.sceneRecords());},
   snapshot:async()=>({}),
   deposit:async()=>{},
   step(){},
   read:()=>({}),
   dispose(){},
  }),
 });
 await ashObj.initialize();
 assert.equal(synced.length,1);
 assert.equal(synced[0].length,2,'primary placement + 1 repetition copy');
 assert.notEqual(synced[0][0].object.geometry,heroGeom,'must use 5000-face stunt double instead of hero');
 assert.equal(synced[0][0].object.geometry.parameters.widthSegments,2,'0.04m ash uses 5000-face tier geometry');
 assert.equal(synced[0][0].object.geometry.userData.kaminosWarpApplied,true,'vertex warp propagated to ash collision stunt double');
 assert.notEqual(synced[0][0].object,synced[0][1].object,'distinct proxy Mesh instances for each repetition copy');
 assert.deepEqual(synced[0][0].object.matrixWorld.elements.slice(12,15),[-1,0,2]);
 assert.deepEqual(synced[0][1].object.matrixWorld.elements.slice(12,15),[1,0,2]);

 await ashObj.regrid(0.02);
 assert.equal(synced.length,2);
 assert.equal(synced[1][0].object.geometry.parameters.widthSegments,4,'0.02m regrid upgrades collision stunt double to 25000-face tier');

 // ASHLOD-F2 (a): Disabling GI proxy for lighting comparison must not purge Stunt Double collision rungs or levels
 giProxies.disable(kilnRoot);
 assert.equal(giProxies.get(kilnRoot).state,'disabled');
 assert.equal(giProxies.get(kilnRoot).proxyRoot,null);
 await ashObj.checkpoint();
 assert.equal(synced.length,3);
 assert.notEqual(synced[2][0].object.geometry,heroGeom,'disabling GI proxy must not force ash collision back onto hero mesh');
 assert.equal(synced[2][0].object.geometry.parameters.widthSegments,4,'disabled GI proxy retains 25000-face collision stunt double');

 // ASHLOD-F2 (b): Late-imported mesh whose Stunt Double is still in flight must not voxelize 30k hero mesh first
 const lateSha='9'.repeat(64);
 const lateRoot=new Group();
 lateRoot.userData.kaminosSceneObject={id:'kiln-2',type:'glb',source:`/api/read?root=generated-meshes&path=${lateSha}.glb`};
 const lateHeroGeom=new BoxGeometry(1,2,1,50,50,50);
 lateRoot.add(new Mesh(lateHeroGeom,new MeshBasicMaterial()));
 scene.add(lateRoot);
 giProxies.select(lateRoot,{faces:1000}); // in-flight!
 const lateRecords=createAshCollisionRecords(ashObj.root,()=>[{id:'kiln-2',type:'glb',object:lateRoot}],{
  getCellSize:()=>0.02,
  resolveCollisionRung:(obj,opts)=>lodController.resolveCollisionRung(obj,opts),
 });
 const whileInFlight=lateRecords();
 assert.equal(whileInFlight.length,0,'while Stunt Double manifest/rung is in flight, must defer rather than voxelizing 30k hero mesh');
 await giProxies.whenIdle();
 const whileRungLoading=lateRecords();
 assert.equal(whileRungLoading.length,0,'while chosen Stunt Double GLB is loading, must defer rather than voxelizing 30k hero mesh');
 await lodController.whenIdle();
 const afterRungReady=lateRecords();
 assert.equal(afterRungReady.length,1,'once Stunt Double rung finishes loading, collision record is emitted');
 assert.notEqual(afterRungReady[0].object.geometry,lateHeroGeom,'emitted collision record uses Stunt Double tier, never hero');

 ashObj.dispose();lodController.dispose();giProxies.clear();
});

import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BURNER_DEFAULTS,createAnnularBurner} from '../annular-burner.mjs';
test('annular burner procedural meshes collapse 29 beauty sub-meshes into a single caster collision proxy',()=>{
 const ashRoot=new Group();
 const burner=createAnnularBurner(THREE,mergeGeometries,BURNER_DEFAULTS);
 burner.group.position.set(1,0.5,-2);
 burner.group.scale.setScalar(20);
 assert.equal(burner.group.children.filter(c=>c.isMesh).length,29,'beauty burner has 29 sub-meshes');
 const list=createAshCollisionRecords(ashRoot,()=>[{id:'burner-floor',type:'procedural-mesh',object:burner.group}]);
 const first=list();
 assert.equal(first.length,1,'annular burner must emit 1 merged collision proxy instead of 29 sub-meshes');
 assert.equal(first[0].collisionTier,'annular-caster');
 assert.ok(first[0].collisionFaces>1000&&first[0].collisionFaces<8000,`expected ~6.6k caster triangles, got ${first[0].collisionFaces}`);
 assert.equal(burner.group.children.filter(c=>c.isMesh).length,29,'beauty burner children remain untouched');
 const second=list();
 assert.equal(second[0].object,first[0].object,'proxy mesh is reused across ticks');
 assert.equal(second[0].object.geometry,first[0].object.geometry,'caster geometry is reused across ticks');
 burner.dispose();
});


