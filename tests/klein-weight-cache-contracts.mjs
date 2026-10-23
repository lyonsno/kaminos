// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {KleinPipeline} from '../models/flux2-klein/klein-pipeline.js';
import {createAuthoringImagePipeline} from '../authoring-image-generation.mjs';

const payload=Uint8Array.of(7,8,9,10),bundle={file:'weight.bin',bytes:4,sha256:'fixture-digest'};
const urls={textEncoderUrl:'https://weights.test/te',transformerUrl:'https://weights.test/dit',vaeUrl:'https://weights.test/vae'};
function fixture({cacheWeights,entry=bundle,cached=null,body=payload,gzipMissing=false}={}){
 const requests=[],cacheCalls=[],received=[],stored=new Map();
 const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
 globalThis.caches={open:async()=>{cacheCalls.push('open');return {
  match:async key=>{cacheCalls.push(['match',key]);return cached?new Response(cached):stored.get(key)?.clone();},
  put:async(key,response)=>{cacheCalls.push(['put',key]);stored.set(key,response.clone());},
  delete:async key=>{cacheCalls.push(['delete',key]);},
 };}};
 globalThis.fetch=async(url,init)=>{requests.push({url,init});if(url.endsWith('manifest.json'))return Response.json({config:{},bundles:{w:entry}});
 if(url.endsWith('.gz'))return gzipMissing?new Response(null,{status:404}):new Response(gzipSync(body));
 if(init?.headers?.Range)return new Response(payload,{status:206});return new Response(body);};
 const p=new KleinPipeline({queue:{},limits:{}},{...urls,...(cacheWeights===undefined?{}:{cacheWeights})});
 p.sched.flush=async()=>{};p.precompile=async()=>{};
 const model=()=>({weightsResident:false,unloadWeights(){this.weightsResident=false;},destroy(){},async loadBundles(fetchBundle,onBytes){const b=await fetchBundle(entry.file,entry);received.push(new Uint8Array(b));onBytes(entry.file,b.byteLength);this.weightsResident=true;}});
 p.textEncoder=model();p.transformer=model();p.createTransformer=model;
 return {p,requests,cacheCalls,received,restore(){globalThis.fetch=originalFetch;globalThis.caches=originalCaches;}};
}

test('cache opt-out loads full bytes on each residency swap without opening browser storage',async()=>{
 const f=fixture({cacheWeights:false,cached:Uint8Array.of(0,0,0,0)});
 try{await f.p.useWeights('textEncoder');f.p.textEncoder.weightsResident=false;await f.p.useWeights('textEncoder');
 assert.deepEqual(f.cacheCalls,[]);assert.equal(f.requests.length,2);assert.ok(f.requests.every(r=>r.init?.cache==='no-store'));assert.deepEqual(f.received,[payload,payload]);}finally{f.restore();}
});
test('default remote caching retains digest keys and avoids a second fetch',async()=>{
 const f=fixture();try{await f.p.useWeights('textEncoder');f.p.textEncoder.weightsResident=false;await f.p.useWeights('textEncoder');
 assert.equal(f.requests.length,1);assert.notEqual(f.requests[0].init?.cache,'no-store');assert.ok(f.cacheCalls.some(c=>c[0]==='put'&&c[1]===urls.textEncoderUrl+'/weight.bin#sha256=fixture-digest'));assert.deepEqual(f.received,[payload,payload]);}finally{f.restore();}
});
for(const gzipMissing of [false,true])test(`cache opt-out covers compressed weights and fallback (missing=${gzipMissing})`,async()=>{
 const f=fixture({cacheWeights:false,gzipMissing,entry:{...bundle,gzip:{file:'weight.bin.gz',bytes:24}}});
 try{await f.p.useWeights('transformer');assert.deepEqual(f.cacheCalls,[]);assert.ok(f.requests.every(r=>r.init?.cache==='no-store'));assert.deepEqual(f.received,[payload]);assert.equal(f.requests.length,gzipMissing?2:1);}finally{f.restore();}
});
test('uncached truncated bundles still fail manifest length validation',async()=>{
 const f=fixture({cacheWeights:false,body:payload.subarray(0,3)});try{await assert.rejects(f.p.useWeights('textEncoder'),/received 3 bytes, manifest says 4/);assert.deepEqual(f.received,[]);}finally{f.restore();}
});
test('transformer replacement and embedding range reads honor cache opt-out',async()=>{
 const f=fixture({cacheWeights:false});try{await f.p.loadTransformer(urls.transformerUrl);f.p.teManifest={embedding:{file:'embed.bin',row_bytes:4}};
 const rows=await f.p.fetchEmbeddingRows([2]);assert.deepEqual(new Uint8Array(rows.get(2)),payload);assert.equal(f.requests.at(-1).init.headers.Range,'bytes=8-11');assert.ok(f.requests.every(r=>r.init?.cache==='no-store'));assert.deepEqual(f.cacheCalls,[]);}finally{f.restore();}
});
test('initial manifest and tokenizer loading honor cache opt-out',async()=>{
 const f=fixture({cacheWeights:false});const real=f.p.createTransformer;
 try{globalThis.fetch=async(url,init)=>{f.requests.push({url,init});return url.endsWith('manifest.json')?Response.json({config:{},bundles:{},tokenizer:{file:'tokenizer.json'},bundle}):Response.json({model:{type:'BPE',vocab:{},merges:[]},added_tokens:[]});};
 f.p.createTransformer=()=>{throw Error('fixture ends after tokenizer and text weights');};await assert.rejects(f.p.load(),/fixture ends after tokenizer/);assert.deepEqual(f.cacheCalls,[]);assert.ok(f.requests.every(r=>r.init?.cache==='no-store'));assert.equal(f.p.loadStats.cacheWeights,false);
 }finally{f.p.createTransformer=real;f.restore();}
});
test('Kaminos local FLUX.3 opts out while hosted Klein keeps caching',async()=>{
 const device={queue:{},limits:{}};const local=await createAuthoringImagePipeline(device,urls,'flux3'),remote=await createAuthoringImagePipeline(device,urls,'flux2');
 assert.equal(local.cacheWeights,false);assert.equal(remote.cacheWeights,true);
});
