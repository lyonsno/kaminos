// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/fracture-shape.experiment.mjs';
import {buildShapeGraph,partitionShape,geodesicNeckPartition} from '../fracture-shape-partition.mjs';

function setup(){
 const source=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());source.add(mesh);
 const scene=new THREE.Scene();scene.add(source);let terminated=false,removed=false;
 class Worker{
  postMessage(data){queueMicrotask(()=>{if(terminated)return;try{if(data.geometry)this.graph=buildShapeGraph(data.geometry);this.onmessage({data:{id:data.id,result:geodesicNeckPartition(this.graph,data.settings)}});}catch(e){this.onmessage({data:{id:data.id,error:e.message}});}});}
  terminate(){terminated=true;}
 }
 const session={async loadAsset(){return {id:'source',root:source};},setView(v){return v;},redraw(){assert.equal(removed,false);},async dispose(){removed=true;source.removeFromParent();}};
 return {Worker,host:{scene:{open:async()=>session}},source,mesh,events:[],get terminated(){return terminated;},get removed(){return removed;}};
}

test('experiment compares exact source, retains all triangles and closes its worker',async()=>{
 const f=setup(),old=globalThis.Worker;globalThis.Worker=f.Worker;
 try{
  const api=await definition.create({host:f.host,inputs:{source:'/source.glb'},record:e=>f.events.push(e)});
  assert.equal(api.read().triangleCount,12);assert.equal(api.read().partition.parts.reduce((s,p)=>s+p.triangles,0),12);
  assert.equal(f.mesh.visible,false);api.operations.view('original');assert.equal(f.mesh.visible,true);
  api.operations.view('regions');assert.equal(f.mesh.visible,false);
  const exported=api.operations.export();assert.equal(exported.labels.length,12);
  await assert.rejects(api.operations.partition({minReachFraction:NaN,minAreaFraction:0}),/finite/);
  assert.equal(api.read().partition.parts.length,1);
  await api.dispose();assert.equal(f.terminated,true);assert.equal(f.removed,true);
 }finally{globalThis.Worker=old;}
});

test('a failed setup disposes the acquired scene and never presents an empty success',async()=>{
 const f=setup(),old=globalThis.Worker;globalThis.Worker=class{constructor(){throw Error('worker unavailable');}};
 try{await assert.rejects(definition.create({host:f.host,inputs:{source:'/source.glb'},record(){}}),/worker unavailable/);assert.equal(f.removed,true);}
 finally{globalThis.Worker=old;}
});
