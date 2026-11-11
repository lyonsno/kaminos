// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
const name=new URL('../authoring-image-serving.mjs',import.meta.url);
const module=await import(name).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===name.href)return {};throw error;});
const create=options=>{assert.equal(typeof module.createAuthoringImageServingOptions,'function','ordinary page and worker need the actual serving services');return module.createAuthoringImageServingOptions(options);};
const response=(value,ok=true)=>({ok,json:async()=>value});
const png=new File([new Uint8Array([137,80,78,71,0,255])],'a basin & hinge.png',{type:'image/png'});

test('weights resolve current runtime configuration with ordinary published fallback and explicit FLUX3 refusal',async()=>{
 let config={klein:{mounted:true,weightsUrl:'/klein-weights'},flux3:{mounted:true,weightsUrl:'/flux3-weights'}},ok=true;
 const calls=[],serving=create({request:async(...args)=>{calls.push(args);return response(config,ok);}});
 assert.equal(await serving.weights('flux2'),'/klein-weights');assert.equal(await serving.weights('flux3'),'/flux3-weights');
 config={};assert.match(await serving.weights('flux2'),/^https:\/\/huggingface.co\/BasinShapers\/flux2-klein-4b-webgpu/);
 await assert.rejects(serving.weights('flux3'),/unavailable/);
 ok=false;assert.match(await serving.weights('flux2'),/^https:\/\//);await assert.rejects(serving.weights('flux3'),/unavailable/);
 for(const [url,options]of calls){assert.equal(url,'/api/runtime-config');assert.equal(options.cache,'no-store');}
 const failed=create({request:async()=>{throw Error('offline');}});await assert.rejects(failed.weights('flux2'),/offline/);
});

test('delivery uses the actual image-ingest wire contract, exact bytes and retained provenance without page history',async()=>{
 const entry={source:'/api/read?root=image-inbox&path=stored.png',name:png.name,root_id:'image-inbox',sha256:'sha256:example'};
 const calls=[],serving=create({request:async(...args)=>{calls.push(args);return response({schema:'kaminos.asset-ingest.v0',kind:'image',entry});}});
 const provenance={schema:'kaminos.image-generation.v1',prompt:'a hinge',seed:3},result=await serving.deliver(png,provenance);
 const [url,options]=calls[0];assert.equal(url,'/api/ingest-image?'+new URLSearchParams({name:png.name}));assert.equal(options.method,'POST');
 assert.deepEqual(new Uint8Array(options.body),new Uint8Array(await png.arrayBuffer()));
 assert.deepEqual(result,{...entry,provenance});provenance.seed=9;assert.equal(result.provenance.seed,3);
 assert.deepEqual(await serving.deliver(png),entry,'ordinary uploads retain the canonical server entry');
});

test('failed or malformed persistence cannot publish a saved image',async()=>{
 for(const [value,ok]of [[{error:'disk unavailable'},false],[{schema:'wrong',kind:'image',entry:{source:'/saved'}},true],[{schema:'kaminos.asset-ingest.v0',kind:'mesh',entry:{source:'/saved'}},true],[{schema:'kaminos.asset-ingest.v0',kind:'image',entry:{}},true]]){
  const serving=create({request:async()=>response(value,ok)});await assert.rejects(serving.deliver(png),/disk unavailable|Image storage failed/);
 }
 const serving=create({request:async()=>({ok:true,json:async()=>{throw SyntaxError('not JSON');}})});await assert.rejects(serving.deliver(png),/not JSON/);
});

test('stale command refuses before POST and cannot report success after an already-started write',async()=>{
 let current=true,posts=0;
 const assertCurrent=()=>{if(!current)throw Object.assign(Error('stale image request'),{name:'AbortError'});};
 const serving=create({request:async()=>{posts++;current=false;return response({schema:'kaminos.asset-ingest.v0',kind:'image',entry:{source:'/saved'}});}});
 current=false;await assert.rejects(serving.deliver(png,null,{assertCurrent}),{name:'AbortError'});assert.equal(posts,0);
 current=true;const lateFile={name:png.name,arrayBuffer:async()=>{current=false;return png.arrayBuffer();}};
 await assert.rejects(serving.deliver(lateFile,null,{assertCurrent}),{name:'AbortError'});assert.equal(posts,0);
 current=true;await assert.rejects(serving.deliver(png,null,{assertCurrent}),{name:'AbortError'});assert.equal(posts,1,'a started server write is not claimed to roll back');
});
