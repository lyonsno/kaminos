// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Worker as NodeWorker} from 'node:worker_threads';
import * as THREE from '../lib/three.core.js';
import * as arrival from '../asset-arrival.mjs';
import {findRestingPlanes,chooseLevelingPlane,levelingWorldDelta} from '../asset-resting-plane.mjs';
import {snapshotAssetGeometry,restoreAssetGeometry,assetWorldGeometry,prepareAssetGeometryArrival,prepareAssetGeometryOffThread,prepareAssetBoundsOffThread,createAssetBoundsCache} from '../asset-geometry-preparation.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function model(){
 const root=new THREE.Group(),nested=new THREE.Group();nested.position.set(.2,.1,-.3);nested.rotation.y=.3;root.add(nested);
 nested.add(new THREE.Mesh(new THREE.BoxGeometry(.9,1.2,.6),new THREE.MeshBasicMaterial()));
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Float32Array([0,0,0,99,.8,0,0,99,0,.5,0,99,0,0,.8,99]),4),3,0));
 geometry.setIndex([0,1,2,0,2,3,0,3,1,1,3,2]);
 const second=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());second.position.x=1.3;root.add(second);
 root.rotation.x=.12;root.position.set(.4,.7,-.2);return root;
}
function reference(root,options){
 const c={THREE,...arrival,findRestingPlanes,chooseLevelingPlane,levelingWorldDelta,groundPlane:{position:{y:options.groundY}},controls:{target:new THREE.Vector3(options.anchor[0],0,options.anchor[1])},camera:{position:new THREE.Vector3(...options.viewDirection).add(new THREE.Vector3(options.anchor[0],0,options.anchor[1]))},appendArrivalObstacles:()=>options.obstacles,recordAssetArrivalLightingAndGI(){}};
 vm.createContext(c);vm.runInContext(section('function applyAssetArrival(', '// Floor footprints')+section('function levelObjectOnArrival(', 'function levelingStillApplied(')+section('function sceneObjectWorldGeometry(', 'function sceneObjectWorldPoints('),c);
 c.sceneObjectRestingAnalysis=object=>{const {points,triangles}=c.sceneObjectWorldGeometry(object,{triangles:true});const analysis=findRestingPlanes(points,triangles);return{analysis,choice:chooseLevelingPlane(analysis)};};
 const placement=c.applyAssetArrival(root,options.mode),box=new THREE.Box3().setFromObject(root,true);
 return{placement:structuredClone(placement),pose:{position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray(),matrix:root.matrix.toArray()},leveling:root.userData.kaminosLeveling??null,arrivalData:root.userData.kaminosAssetArrival??null,bounds:box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray()},framing:options.mode==='fresh'&&placement?arrival.computeAssetArrivalFraming({...options.framing,points:c.sceneObjectWorldGeometry(root).points}):null};
}
const options={mode:'fresh',groundY:-.85,anchor:[0,0],viewDirection:[0,0,1],obstacles:[],framing:{fovDeg:45,aspect:1.4,window:{left:-.62,right:.62,bottom:-.62,top:.42}}};
test('prepared full geometry exactly preserves existing arrival placement, leveling and framing',()=>{
 for(const mode of ['fresh','append',null]){
  const opts={...options,mode,anchor:mode==='append'?[.7,-.3]:[0,0],obstacles:[{min:[-.5,-1,-.5],max:[.5,1,.5]}]};
  const original=model(),snapshot=snapshotAssetGeometry(original).snapshot;
  const result=prepareAssetGeometryArrival(structuredClone(snapshot),opts),expected=reference(original,opts);
  for(const key of Object.keys(expected))assert.deepEqual(result[key],structuredClone(expected[key]),mode+' '+key);
 }
});
test('snapshots preserve typed/interleaved attributes, indices and hierarchy without detaching source arrays',()=>{
 const root=model(),captured=snapshotAssetGeometry(root),copy=restoreAssetGeometry(structuredClone(captured.snapshot)).root;
 assert.deepEqual(assetWorldGeometry(copy,{triangles:true}),assetWorldGeometry(root,{triangles:true}));
 assert.ok(captured.originals.every(g=>g.getAttribute('position').array?.byteLength||g.getAttribute('position').data.array.byteLength));
});
test('custom, instanced, skinned and morph geometry retain their compatibility path',()=>{
 const morph=model();morph.children[0].children[0].geometry.morphAttributes.position=[new THREE.Float32BufferAttribute([0,0,0],3)];
 const proxy=new THREE.Group();proxy.sceneGeometry=new THREE.BoxGeometry();
 for(const root of [new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1),new THREE.SkinnedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),morph,proxy])assert.equal(snapshotAssetGeometry(root),null);
});

class BrowserWorker {
 constructor(url){
  const bootstrap=`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:value=>parentPort.postMessage(value)};await import(${JSON.stringify(String(url))});parentPort.on('message',data=>self.onmessage({data}));`;
  this.worker=new NodeWorker(new URL('data:text/javascript,'+encodeURIComponent(bootstrap)),{type:'module'});
  this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));this.worker.on('messageerror',error=>this.onmessageerror?.(error));
 }
 postMessage(message){this.worker.postMessage(message);}
 terminate(){return this.worker.terminate();}
}
test('actual module worker scans vertices off-thread and leaves source buffers and resources owned',async()=>{
 const root=model();root.traverse(node=>{if(node.geometry){node.geometry.computeBoundingBox=()=>assert.fail('main-thread bounds scan');node.geometry.computeBoundingSphere=()=>assert.fail('main-thread sphere scan');const p=node.geometry.getAttribute('position');p.getX=()=>assert.fail('main-thread vertex access');}});
 const result=await prepareAssetGeometryOffThread(root,options,{Worker:BrowserWorker});
 assert.equal(result.effectiveRoute,'static-geometry-worker');assert.ok(result.framing);assert.ok(result.placement);
 root.traverse(node=>{if(node.geometry){assert.ok(node.geometry.boundingBox);assert.ok(node.geometry.boundingSphere);}});
});
test('worker failures and incomplete replies reject and terminate instead of claiming preparation',async()=>{
 for(const response of [{error:'bad geometry'},{result:{}},{event:'error'}]){
  let terminated=0;
  class Broken {postMessage(){queueMicrotask(()=>response.event?this.onerror({message:'worker failed'}):this.onmessage({data:response}));}terminate(){terminated++;}}
  await assert.rejects(prepareAssetGeometryOffThread(model(),options,{Worker:Broken}),/bad geometry|Incomplete|worker failed/);assert.equal(terminated,1);
 }
});

test('continued camera motion does not starve geometry publication',async()=>{
 let movement=0,calls=0;
 const prepared={placement:null};
 const camera={position:{toArray:()=>[movement++,0,1],clone:()=>new THREE.Vector3(0,0,1)},fov:45,aspect:1};
 const c={THREE,JSON,workingScene:{objects:[]},groundPlane:{position:{y:0}},controls:{target:new THREE.Vector3()},camera,viewportOverlayTopNdc:()=>1,assetArrivalFramingWindow:arrival.assetArrivalFramingWindow,
  prepareAssetGeometryOffThread:async()=>{assert.equal(++calls,1,'camera motion must not restart a completed static preparation');return prepared;}};
 vm.createContext(c);vm.runInContext(section('async function prepareGLBGeometryArrival(', 'function applyAssetArrival('),c);
 assert.equal(await c.prepareGLBGeometryArrival(model(),'fresh'),prepared);
});


test('malformed worker poses cannot masquerade as completed geometry preparation',async()=>{
 let terminated=false;
 class Malformed {postMessage({snapshot}){queueMicrotask(()=>this.onmessage({data:{result:{effectiveRoute:'static-geometry-worker',pose:{},geometryBounds:snapshot.geometries.map(()=>({box:null,sphere:null}))}}}));}terminate(){terminated=true;}}
 await assert.rejects(prepareAssetGeometryOffThread(model(),options,{Worker:Malformed}),/Incomplete/);assert.ok(terminated);
});

test('append GI calibration consumes prepared bounds for existing roots instead of scanning their vertices again',()=>{
 const old=new THREE.Group(),added=new THREE.Group(),oldBounds={min:[-2,0,-2],max:[2,2,2]},newBounds={min:[3,0,0],max:[4,1,1]},cache=new Map([[old,oldBounds],[added,newBounds]]);let calibrated;
 class NoScanBox extends THREE.Box3{setFromObject(){assert.fail('main-thread vertex rescan despite prepared bounds');}}
 const c={THREE:{...THREE,Box3:NoScanBox},sceneGIManuallyConfigured:false,sceneGIBounceManuallyConfigured:false,sceneGISettings:{},sceneGIAutoCalibrationState:null,
  workingScene:{objects:[{object:old,type:'glb'},{object:added,type:'glb'}]},readPreparedAssetBounds:object=>cache.get(object),camera:null,controls:null,
  calibrateSceneGISettingsForBounds:input=>{calibrated=input;return{};},setSceneGIControls(){}};
 vm.createContext(c);vm.runInContext(section('function autoCalibrateSceneGIFromScene(', 'function recordAssetArrivalLightingAndGI('),c);
 c.autoCalibrateSceneGIFromScene(added,newBounds);assert.deepEqual(structuredClone(calibrated.boxes),[oldBounds,newBounds]);
});


test('bounds cache invalidates on transforms, hierarchy and uploaded geometry changes',()=>{
 const root=model(),cache=createAssetBoundsCache(),bounds={min:[-1,-1,-1],max:[1,1,1]};
 assert.equal(cache.remember(root,bounds),true);assert.deepEqual(cache.read(root),bounds);
 const copy=cache.read(root);copy.min[0]=99;assert.deepEqual(cache.read(root),bounds);
 root.position.x+=1;assert.equal(cache.read(root),null);
 cache.remember(root,bounds);const g=root.children[0].children[0].geometry;g.attributes.position.needsUpdate=true;assert.equal(cache.read(root),null);
 cache.remember(root,bounds);root.add(new THREE.Object3D());assert.equal(cache.read(root),null);
 cache.remember(root,bounds);g.setAttribute('position',g.attributes.position.clone());assert.equal(cache.read(root),null);
});
test('one bounds worker handles multiple final saved transforms and parent-group pivots',async()=>{
 const parent=new THREE.Group();parent.position.set(2,1,-.8);parent.rotation.y=.6;parent.scale.set(1.2,.8,1.1);const first=model(),second=model();second.position.x=-2;parent.add(first);parent.add(second);
 let created=0;class Counted extends BrowserWorker{constructor(url){super(url);created++;}}
 const expected=[first,second].map(root=>{root.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(root,true);return{min:box.min.toArray(),max:box.max.toArray()};});
 const rows=await prepareAssetBoundsOffThread([first,second],{Worker:Counted});assert.equal(created,1);assert.equal(rows.length,2);
 const cache=createAssetBoundsCache();for(let i=0;i<rows.length;i++){assert.deepEqual(rows[i].bounds,expected[i]);assert.ok(cache.remember(rows[i].root,rows[i].bounds,rows[i].state));}
 assert.deepEqual(cache.read(first),expected[0]);parent.position.y+=1;assert.equal(cache.read(first),null);
});
test('local-only source preparation fills reusable geometry bounds without computing unused world boxes',async()=>{
 const root=model(),rows=await prepareAssetBoundsOffThread([root],{localOnly:true,Worker:BrowserWorker});assert.equal(rows.length,1);assert.equal(rows[0].bounds,null);assert.equal(rows[0].effectiveRoute,'static-local-bounds-worker');
 root.traverse(node=>{if(node.geometry){assert.ok(node.geometry.boundingBox);assert.ok(node.geometry.boundingSphere);}});
});
test('saved-record arrival does not start its own geometry worker',async()=>{
 const c={prepareAssetGeometryOffThread:()=>assert.fail('saved records must reuse prepared source bounds')};vm.createContext(c);vm.runInContext(section('async function prepareGLBGeometryArrival(', 'function applyAssetArrival('),c);assert.equal(await c.prepareGLBGeometryArrival(model(),null),null);
});


test('worker obstacle placement includes the existing object parent-group transform',()=>{
 const parent=new THREE.Group();parent.position.x=12;const obstacle=new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));parent.add(obstacle);obstacle.updateWorldMatrix(true,true);
 const box=new THREE.Box3().setFromObject(obstacle,true),worldBox={min:box.min.toArray(),max:box.max.toArray()};
 const incoming=model(),opts={...options,mode:'append',obstacles:[worldBox],obstacleSources:[{snapshot:snapshotAssetGeometry(obstacle).snapshot}]};
 const actual=prepareAssetGeometryArrival(snapshotAssetGeometry(incoming).snapshot,opts),expected=reference(incoming,opts);
 assert.deepEqual(actual.arrivalData,structuredClone(expected.arrivalData));assert.deepEqual(actual.obstacleBounds,[worldBox]);
});
test('bounds batch rejects partial output and closes its worker',async()=>{
 let closed=false;class Partial{postMessage(){queueMicrotask(()=>this.onmessage({data:{result:{effectiveRoute:'static-world-bounds-worker',rows:[]}}}));}terminate(){closed=true;}}
 await assert.rejects(prepareAssetBoundsOffThread([model()],{Worker:Partial}),/Incomplete asset bounds/);assert.ok(closed);
});
test('unchanged cached bounds never read vertex coordinates on the main thread',()=>{
 const root=model(),cache=createAssetBoundsCache(),bounds={min:[-1,0,-1],max:[1,1,1]};cache.remember(root,bounds);
 root.traverse(node=>{if(node.geometry)node.geometry.getAttribute('position').getX=()=>assert.fail('cached bounds touched vertices');});
 assert.deepEqual(cache.read(root),bounds);
});


test('worker bounds preserve matrix-authored children and parent world transforms',()=>{
 const parent=new THREE.Group();parent.position.set(12,3,-1);
 const root=new THREE.Group();root.position.x=2;parent.add(root);
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());mesh.matrixAutoUpdate=false;mesh.matrix.makeTranslation(10,0,0);mesh.matrixWorldNeedsUpdate=true;root.add(mesh);
 root.updateWorldMatrix(true,true);const expected=new THREE.Box3().setFromObject(root,true),copy=restoreAssetGeometry(snapshotAssetGeometry(root).snapshot).root;
 const actual=new THREE.Box3().setFromObject(copy,true);assert.deepEqual(actual.min.toArray(),expected.min.toArray());assert.deepEqual(actual.max.toArray(),expected.max.toArray());
});
test('fresh preparation measures the toolbar that will become visible and restores hidden state',async()=>{
 let visible=false,received;
 const bar={classList:{contains:()=>visible,add:()=>{visible=true;},remove:()=>{visible=false;}},getBoundingClientRect:()=>visible?{left:0,right:800,top:56,bottom:120,width:800,height:64}:{left:0,right:0,top:0,bottom:0,width:0,height:0}};
 const c={THREE,JSON,workingScene:{objects:[]},groundPlane:{position:{y:0}},controls:{target:new THREE.Vector3()},camera:{position:new THREE.Vector3(0,0,1),fov:45,aspect:2},
  document:{getElementById:()=>bar},renderer:{domElement:{getBoundingClientRect:()=>({left:0,right:800,top:0,height:400})}},assetArrivalFramingWindow:arrival.assetArrivalFramingWindow,
  prepareAssetGeometryOffThread:async(_root,opts)=>{received=opts;return{placement:null};}};
 vm.createContext(c);vm.runInContext(section('function viewportOverlayTopNdc(', 'function frameAssetArrival(')+section('async function prepareGLBGeometryArrival(', 'function applyAssetArrival('),c);
 await c.prepareGLBGeometryArrival(model(),'fresh');assert.equal(visible,false);assert.ok(Math.abs(received.framing.window.top-.35)<1e-12,JSON.stringify(received.framing.window));
 await c.prepareGLBGeometryArrival(model(),'fresh',()=>true,{activate:false});assert.equal(received.framing.window.top,.62);assert.equal(visible,false);
});

test('worker preserves an unparented matrix-authored root',()=>{
 const root=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());root.matrixAutoUpdate=false;root.matrix.makeTranslation(8,3,-2);root.matrixWorldNeedsUpdate=true;
 const expected=new THREE.Box3().setFromObject(root,true),copy=restoreAssetGeometry(snapshotAssetGeometry(root).snapshot).root,actual=new THREE.Box3().setFromObject(copy,true);
 assert.deepEqual(actual.min.toArray(),expected.min.toArray());assert.deepEqual(actual.max.toArray(),expected.max.toArray());
});
