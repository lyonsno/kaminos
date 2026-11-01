// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createTrellisPageAuthoringGeneration}from '../authoring-trellis-page.mjs';
const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
const a=html.indexOf('const persistTrellisPageRun=async out=>{'),b=html.indexOf('\n  // TRELLIS in this page',a);
const decoration=html.slice(html.indexOf('      // Decoding succeeded and mesh finishing failed:'),html.indexOf('      if(error?.trellisCapture)'));
const fields=()=>({decode:{vertices:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2])},materialFields:{features:new Float32Array([1,-1,.5,0,.8,1]),coordinates:new Int32Array([800,900,1000]),resolution:1024}});
for(const retry of [false,true])test(`actual failed-finish page retains raw1024 fields with source identity; retry=${retry}`,async()=>{
 const inputs=fields(),stored=[];let diskFails=retry,runs=0;
 const persist=Function('persistGeneratedMesh','sha256Of','window','setInfo','console','loadModule',`${html.slice(a,b)};return persistTrellisPageRun;`)(
  async(glb,generation,label,suffix)=>{if(diskFails)throw Error('disk full');stored.push({glb,generation,label,suffix});return {source:'/saved.glb',sha256:'a'.repeat(64),name:label};},
  async()=>'',{},()=>{},{warn(){}},s=>import(new URL('../'+s.replace('./',''),import.meta.url)));
 const service=createTrellisPageAuthoringGeneration({availability:()=>({status:'available'}),
  async runPage(){runs++;const error=Object.assign(Error('UV unwrap failed'),{trellisSurfels:{surfelGlb:null,surfels:{status:'failed',error:'resolution 1..512 required'},levelInputs:inputs,route:'trellis2.image-generation.webgpu.v0'}});
   Function('error','signal','label','runId','imageSha256','image','pixels','preparation','pack',decoration)(error,null,'elbow','run-raw','b'.repeat(64),{source:'/original.png'},null,null,{manifestSha256:'c'.repeat(64)});throw error;},
  persist:(glb,generation,label,extra)=>persist({glb,generation,label,...extra})});
 await assert.rejects(service.run({source:'/original.png',label:'elbow'}),/UV unwrap failed/);
 if(retry){assert.equal(service.busy(),true,'raw inputs remain pending after failed storage');diskFails=false;await service.retryPersistence();}
 assert.equal(stored.length,1,'a recovery artifact is stored even without either finished export');assert.equal(runs,1);
 const {decodeTrellisReconstruction}=await import('../trellis-reconstruction.mjs');
 const restored=decodeTrellisReconstruction(stored[0].glb);assert.deepEqual(restored.levelInputs,inputs);
 assert.equal(stored[0].generation.runId,'run-raw');assert.equal(stored[0].generation.input.source,'/original.png');assert.equal(stored[0].generation.meshFinishing.status,'failed');
 assert.equal(service.read().status,'failed');assert.match(service.read().error,/UV unwrap failed/);assert.equal(service.busy(),false);
});

test('recovery copies offset array views losslessly and rejects unknown schemas',async()=>{
 const {encodeTrellisReconstruction,decodeTrellisReconstruction}=await import('../trellis-reconstruction.mjs');
 const original=fields(),offsetCopy=(T,a)=>{const backing=new T(a.length+4);backing.set(a,2);return backing.subarray(2,2+a.length);};
 original.decode.vertices=offsetCopy(Float32Array,original.decode.vertices);original.decode.triangles=offsetCopy(Uint32Array,original.decode.triangles);
 original.materialFields.features=offsetCopy(Float32Array,original.materialFields.features);original.materialFields.coordinates=offsetCopy(Int32Array,original.materialFields.coordinates);
 const glb=encodeTrellisReconstruction(original,{provenance:{runId:'retained-run'}});const restored=decodeTrellisReconstruction(glb);
 assert.deepEqual(restored.levelInputs,original);assert.equal(restored.provenance.runId,'retained-run');
 original.decode.vertices.fill(7);assert.equal(restored.levelInputs.decode.vertices[0],0);
 const bytes=new Uint8Array(glb),index=Buffer.from(glb).indexOf('kaminos.trellis-reconstruction.v1');assert.ok(index>0);bytes[index]='x'.charCodeAt(0);
 assert.throws(()=>decodeTrellisReconstruction(glb),/unsupported reconstruction schema/);
});

test('raw recovery stays a viewable GLB for the existing Three loader',async()=>{
 const {encodeTrellisReconstruction}=await import('../trellis-reconstruction.mjs');
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 const glb=encodeTrellisReconstruction(fields());
 const parsed=await new GLTFLoader().parseAsync(glb,'');let mesh;parsed.scene.traverse(o=>{if(o.isMesh)mesh=o;});
 assert.ok(mesh);assert.equal(mesh.geometry.attributes.position.count,3);assert.equal(mesh.geometry.index.count,3);
 assert.deepEqual([...mesh.geometry.attributes.position.array], [...fields().decode.vertices]);
});
