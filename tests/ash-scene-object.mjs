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

test('createAshCollisionRecords restores beauty LODs and excludes kaminosBeautyLodProxy meshes',()=>{
 const root=new Group();
 const obstacle=new Group();
 const heroMesh=new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial());
 const beautyProxy=new Group();
 beautyProxy.userData.kaminosBeautyLodProxy=true;
 const proxyMesh=new Mesh(new BoxGeometry(.5,.5,.5),new MeshBasicMaterial());
 beautyProxy.add(proxyMesh);
 obstacle.add(heroMesh);
 obstacle.add(beautyProxy);

 heroMesh.visible=false;
 beautyProxy.visible=true;
 obstacle.userData.kaminosBeautyLodRestore=()=>{
  heroMesh.visible=true;
  beautyProxy.visible=false;
  return ()=>{
   heroMesh.visible=false;
   beautyProxy.visible=true;
  };
 };

 const list=createAshCollisionRecords(root,()=>[{id:'kiln',type:'glb',object:obstacle}]);
 const records=list();
 assert.equal(records.length,1,'only the restored hero mesh enters ash collision records');
 assert.equal(records[0].object.geometry,heroMesh.geometry,'ash collision record uses hero geometry, not beauty proxy');
 assert.equal(heroMesh.visible,false,'beauty LOD visibility state is restored after createAshCollisionRecords');
 assert.equal(beautyProxy.visible,true,'beauty proxy visibility is restored after createAshCollisionRecords');
});

test('review WO1: createAshCollisionRecords substitutes cellSize-matched stunt-double rung via resolveObstacle instead of hashing full hero mesh',async()=>{
 const THREE=await import('../lib/three.core.js');
 const {createSceneColliderCollection}=await import('../scene-collider.mjs');
 const {createGiProxyRegistry}=await import('../scene-gi-proxies.mjs');

 const HERO_SHA='a'.repeat(64);
 const TIER_500='b'.repeat(64);
 const levels=[
  {sha256:TIER_500,faces:500,closed:true,source:`/api/read?root=generated-meshes&path=${TIER_500}.glb`,error:{diagonal:1.0,relative:{p95:0.002,max:0.008},levelToSource:{p95:0.002,max:0.008},sourceToLevel:{p95:0.002,max:0.008}}},
 ];

 const obstacle=new Group();
 obstacle.position.set(2,0,-3);
 obstacle.userData.kaminosSceneObject={source:`/api/read?root=generated-meshes&path=${HERO_SHA}.glb`};
 const heroGeom=new THREE.SphereGeometry(0.5,64,48); // > 6,000 triangles
 const heroMesh=new Mesh(heroGeom,new MeshBasicMaterial());
 obstacle.add(heroMesh);
 obstacle.updateMatrixWorld(true);

 const stuntGeom=new BoxGeometry(0.8,0.8,0.8,1,1,1); // 12 triangles
 const giProxies=createGiProxyRegistry({
  THREE,
  fetchJson:async()=>({schema:'kaminos.lod-set.v0',source:HERO_SHA,levels,choice:levels[0],withinBudget:true}),
  fetchBytes:async()=>new TextEncoder().encode(TIER_500).buffer,
  digest:async bytes=>new TextDecoder().decode(bytes),
  parseGlb:async()=>{const g=new Group();g.add(new Mesh(stuntGeom,new MeshBasicMaterial()));return g;},
 });
 await giProxies.attach(obstacle,{faces:500});
 const colliderCollection=createSceneColliderCollection(THREE,{giProxies});

 const ashRoot=new Group();
 ashRoot.position.set(1,0,-2);
 ashRoot.userData.kaminosSceneObject={ash:{cellSize:0.04}};
 const list=createAshCollisionRecords(
  ashRoot,
  ()=>[{id:'beam',type:'glb',object:obstacle}],
  {resolveObstacle:(entry,opts)=>colliderCollection.resolveObstacle(entry,opts)}
 );
 const records=list();
 assert.equal(records.length,1,'ash collision emits 1 proxy mesh for stunt-double');
 assert.equal(records[0].object.geometry.attributes.position.count,stuntGeom.attributes.position.count,'WO1: ash obstacle uses 12-triangle stunt-double rung instead of 6,000-triangle hero mesh');
 assert.deepEqual(records[0].object.matrixWorld.elements.slice(12,15),[1,0,-1],'WO1: stunt-double rung is transformed into ash field coordinates');

 obstacle.visible=false;
 assert.equal(list().length,0,'WO1: hidden obstacle is excluded from ash collision records');
});



test('a checkpoint retries exact original colliders after an adaptive collider mismatch and retains that source',async()=>{
 const original=new Mesh(new BoxGeometry(),new MeshBasicMaterial()),proxy=new Mesh(new BoxGeometry(.5,.5,.5),new MeshBasicMaterial());
 const saved={schema:'kaminos.tiled-ash.v1',values:[.25,.75],steps:3522};let sceneRecords,restored,ticks=0;const attempts=[];
 const object=await createAshSceneObject({record:{...record(),ash:{...record().ash,checkpoint:saved}},readObjects:()=>[{id:'mesh',type:'glb',object:original}],resolveObstacle:()=>proxy,createPatch:async options=>{sceneRecords=options.sceneRecords;return {root:new Group(),syncScene(){},restore(state){const geometry=sceneRecords()[0].object.geometry;attempts.push(geometry);if(geometry!==original.geometry)throw Object.assign(Error('Checkpoint scene geometry or poses differ; restore the scene first'),{code:'ASH_CHECKPOINT_COLLISION_MISMATCH'});restored=structuredClone(state);},step(){assert.equal(sceneRecords()[0].object.geometry,original.geometry);ticks++;},read:()=>({steps:saved.steps+ticks}),dispose(){}};}});
 try{await object.initialize();assert.deepEqual(attempts,[proxy.geometry,original.geometry]);assert.deepEqual(restored,saved);assert.equal(object.read().pendingRestore,false);assert.equal(object.read().collisionSource,'checkpoint-original');object.tick(1000);assert.equal(ticks,1);await object.initialize();assert.equal(attempts.length,2);}finally{object.dispose();for(const m of [original,proxy]){m.geometry.dispose();m.material.dispose();}}
});

test('checkpoint recovery still rejects changed original geometry and unrelated checkpoint failures',async()=>{
 for(const code of ['ASH_CHECKPOINT_COLLISION_MISMATCH','INVALID_CHECKPOINT']){
  const original=new Mesh(new BoxGeometry(),new MeshBasicMaterial());let attempts=0;
  const object=await createAshSceneObject({record:{...record(),ash:{...record().ash,checkpoint:{schema:'kaminos.tiled-ash.v1'}}},readObjects:()=>[{id:'mesh',type:'glb',object:original}],resolveObstacle:()=>original,createPatch:async()=>({root:new Group(),syncScene(){},restore(){attempts++;throw Object.assign(Error('refused'),{code});},step(){throw Error('must not step');},read:()=>({}),dispose(){}})});
  try{await assert.rejects(object.initialize(),/refused/);assert.equal(attempts,code==='ASH_CHECKPOINT_COLLISION_MISMATCH'?2:1);assert.equal(object.read().pendingRestore,true);assert.equal(object.tick(1000),false);}finally{object.dispose();original.geometry.dispose();original.material.dispose();}
 }
});
