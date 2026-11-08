// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Worker as NodeWorker} from 'node:worker_threads';
import * as THREE from '../lib/three.core.js';
import * as arrival from '../asset-arrival.mjs';
import {findRestingPlanes,chooseLevelingPlane,levelingWorldDelta} from '../asset-resting-plane.mjs';
import {snapshotAssetGeometry,restoreAssetGeometry,assetWorldGeometry,prepareAssetGeometryArrival,prepareAssetGeometryOffThread} from '../asset-geometry-preparation.mjs';
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
