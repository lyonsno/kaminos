// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {encodeGlb} from '../poly-glb-io.mjs';
import {MESH_MODELS} from '../authoring-trellis-generation.mjs';
import {usedInputStatusFor} from '../authoring-assets.mjs';
const glb=()=>encodeGlb({asset:{version:'2.0'}}).buffer;
test('Generate offers the photograph and identifies unchanged input',()=>{
  assert.equal(MESH_MODELS['material-photo']?.label,'Material Photograph');
  assert.equal(usedInputStatusFor(null,'photo.png','original'),'Original photograph');
});
const path=new URL('../authoring-material-photo.mjs',import.meta.url);
async function factory(){assert.ok(existsSync(path),'Material Photograph authoring service is missing');return (await import(path)).createPhotographAuthoringGeneration;}
test('retains completed output and retries storage without another inference',async()=>{
  const create=await factory();let runs=0,saves=0;
  const output={glb:glb(),generation:{runId:'exact-run'},label:'Photo'};
  const service=create({runPage:async({image,size,onProgress})=>{runs++;assert.equal(image.source,'photo.png');assert.equal(size,1024);onProgress({stage:'geometry',phase:'inferring'});return output;},
    persist:async(...args)=>{saves++;assert.equal(args[0],output.glb);if(saves===1)throw Error('storage offline');return {source:'saved.glb',generation:args[1]};},size:()=>1024});
  assert.equal(service.preparesInput,true);assert.equal(service.read().status,'idle');
  await assert.rejects(service.run({source:'photo.png'}),/storage offline/);
  assert.ok(service.read().pending);assert.equal(service.busy(),false);
  await assert.rejects(service.run({source:'other.png'}),/retained/);
  const saved=await service.retryPersistence();assert.equal(saved.generation.runId,'exact-run');
  assert.equal(runs,1);assert.equal(saves,2);assert.equal(service.read().pending,null);
});
test('stop preserves scene and previous results, ignores late progress and admits retry',async()=>{
  const create=await factory();let started,late,called=0;
  const began=new Promise(resolve=>{started=resolve;});
  const service=create({runPage:async({signal,onProgress})=>{late=onProgress;called++;if(called>1)return {glb:glb(),generation:{},label:'photo'};
    started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));},persist:async()=>({source:'saved.glb'})});
  const running=service.run({source:'photo.png'});await began;assert.equal(service.stop(),true);assert.equal(await running,null);
  late({stage:'materials',phase:'inferring'});assert.equal(service.read().status,'stopped');
  assert.equal((await service.run({source:'photo.png'})).source,'saved.glb');
});
test('unavailable host and concurrent run are refused before inference',async()=>{
  const create=await factory();let calls=0;
  const unavailable=create({blocked:()=> 'Other model active',runPage:async()=>calls++,persist:async()=>{}});
  await assert.rejects(unavailable.run({source:'photo.png'}),/Other model active/);assert.equal(calls,0);
});
test('a device failure during stopping remains a failure',async()=>{
  const create=await factory();let started;
  const began=new Promise(resolve=>{started=resolve;});
  const service=create({runPage:({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(Error('device lost')));}),persist:async()=>{}});
  const running=service.run({source:'photo.png'});await began;service.stop();
  await assert.rejects(running,/device lost/);assert.equal(service.read().status,'failed');
});
test('page adapter shares the app host, reuses models and records the validated source route',async t=>{
  const {createPagePhotographer,PHOTOGRAPH_ROUTE}=await import(path);
  const pixels={width:2,height:2,data:new Uint8ClampedArray(16).fill(255)};
  const encoded=[];
  const replacements={createImageBitmap:async()=>({width:2,height:2,close(){}}),
    OffscreenCanvas:class {getContext(){return {drawImage(){},getImageData(){return pixels;},putImageData(image){encoded.push(image);}};}async convertToBlob(){return new Blob(['test png']);}},
    ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}}};
  for(const [key,value] of Object.entries(replacements)){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);}
  const device={features:new Set(['shader-f16'])},session={},host={device,session:async()=>session,beginRun(){}};
  let constructions=0,geometryRuns=0,materialRuns=0;
  const common=options=>{constructions++;assert.equal(options.device,device);assert.equal(options.session,session);assert.equal(options.foreground,host);assert.equal(options.load,false);return {...options,load:async()=>{}};};
  const run=createPagePhotographer({appHost:async()=>host,fetch:async()=>new Response('original photograph'),dependencies:{
    createMoGeApp:async options=>({...common(options),model:{useRealWeights:true},infer:async()=>{geometryRuns++;return {width:2,height:2,points:new Float32Array([-1,-1,2,1,-1,2,-1,1,2,1,1,2])};}}),
    // supermat-route.js returns named image records inside its result.maps bundle.
    createSuperMatApp:async options=>({...common(options),infer:async({size})=>{materialRuns++;
      const map=value=>({width:size,height:size,data:new Uint8ClampedArray(size*size*4).fill(value)});
      return {width:size,height:size,maps:{albedo:map(71),orm:map(123)}};}}),
  }});
  for(let i=0;i<2;i++){
    const result=await run({image:{source:'photo.png'},size:512});
    assert.equal(result.generation.route,PHOTOGRAPH_ROUTE);
    assert.match(result.generation.input.sha256,/^[a-f0-9]{64}$/);
    assert.equal(result.generation.receiptValidation?.ok,true);
    assert.equal(new DataView(result.glb).getUint32(0,true),0x46546c67);
  }
  assert.equal(constructions,2);assert.equal(geometryRuns,2);assert.equal(materialRuns,2);
  assert.equal(encoded.length,4);
  for(const [i,image] of encoded.entries()){
    assert.equal(image.width,512);assert.equal(image.height,512);assert.equal(image.data.length,512*512*4);
    assert.equal(image.data[0],i%2?123:71);assert.equal(image.data[3],i%2?123:255);
  }
});
