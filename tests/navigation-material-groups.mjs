// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {prepareNavigationGeometry} from '../scene-navigation.mjs';
import {pickSceneWorkerObject} from '../scene-worker-picking.mjs';
import {captureSceneWorkerCamera} from '../scene-worker-page.mjs';
import {Worker as NodeWorker} from 'node:worker_threads';

function fixture(indexed){
 const camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.z=5;camera.updateMatrixWorld(true);
 const geometry=new THREE.BoxGeometry(),materials=Array.from({length:6},()=>new THREE.MeshBasicMaterial({side:THREE.FrontSide}));materials[4].side=THREE.BackSide;
 const front=new THREE.Mesh(indexed?geometry:geometry.toNonIndexed(),materials),back=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());back.position.z=-3;
 front.updateMatrixWorld(true);back.updateMatrixWorld(true);
 const ordinary={camera,workingScene:{objects:[{id:'front',object:front},{id:'back',object:back}],selection:{ids:[]}},visible:()=>true};
 const input={ndc:{x:0,y:0},viewport:{width:100,height:100},camera:captureSceneWorkerCamera(camera,new THREE.Vector3())};
 const ray=new THREE.Raycaster(new THREE.Vector3(0,0,5),new THREE.Vector3(0,0,-1),.1,100);
 const hits=()=>ray.intersectObject(front,false).map(h=>({face:h.faceIndex,material:h.face.materialIndex,distance:h.distance})).sort((a,b)=>a.face-b.face||a.material-b.material);
 return {front,back,materials,ray,hits,pick:()=>pickSceneWorkerObject({THREE,ordinary,input}),dispose(){for(const mesh of [front,back]){mesh.geometry.dispose();for(const m of [].concat(mesh.material))m.dispose();}if(!indexed)geometry.dispose();}};
}
async function exercise(indexed){
 const f=fixture(indexed);try{
  const positions=Array.from(f.front.geometry.attributes.position.array),indices=f.front.geometry.index?Array.from(f.front.geometry.index.array):null;
  const expected=f.hits();assert.equal(f.pick(),'back');await prepareNavigationGeometry(f.front);await prepareNavigationGeometry(f.back);
  assert.equal(f.pick(),'back','material-group side culling must survive index installation');assert.deepEqual(f.hits(),expected,'face/material identity must agree with the original raycast');
  assert.deepEqual(Array.from(f.front.geometry.attributes.position.array),positions);
  if(indices)assert.deepEqual(Array.from(f.front.geometry.index.array),indices,'render triangle order stays unchanged');
  else if(f.front.geometry.index)assert.deepEqual(Array.from(f.front.geometry.index.array),Array.from({length:positions.length/3},(_,i)=>i));
  for(const material of f.materials)material.side=THREE.DoubleSide;
  const accelerated=f.hits();const method=f.front.raycast;f.front.raycast=THREE.Mesh.prototype.raycast;const native=f.hits();f.front.raycast=method;assert.deepEqual(accelerated,native);
  f.ray.firstHitOnly=true;const closest=f.ray.intersectObject(f.front,false)[0];assert.equal(closest.face.materialIndex,4);assert.equal(closest.distance,4.5);
 }finally{f.dispose();}
}
test('fallback index preserves grouped-material picking for indexed and nonindexed source triangles',async()=>{await exercise(true);await exercise(false);});

test('actual committed navigation worker serialization preserves material groups and triangle identity',async()=>{
 const owned=new Set(),previous=globalThis.Worker;
 class BrowserWorker{
  constructor(url){
   const code=`import {parentPort,workerData} from 'node:worker_threads';globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};Object.defineProperty(self,'onmessage',{set(fn){parentPort.on('message',data=>fn({data}));parentPort.postMessage({adapterReady:true});}});await import(workerData.url);`;
   this.worker=new NodeWorker(new URL('data:text/javascript,'+encodeURIComponent(code)),{type:'module',workerData:{url:String(url)}});owned.add(this.worker);
   this.ready=new Promise((resolve,reject)=>{this.worker.on('message',data=>data.adapterReady?resolve():this.onmessage?.({data}));this.worker.on('error',e=>{reject(e);this.onerror?.(e);});});
  }
  postMessage(data,transfer){void this.ready.then(()=>this.worker.postMessage(data,transfer));}
  terminate(){return this.worker.terminate();}
 }
 globalThis.Worker=BrowserWorker;
 try{await exercise(true);await exercise(false);}
 finally{globalThis.Worker=previous;await Promise.all([...owned].map(w=>w.terminate()));}
});
