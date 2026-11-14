// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const url=new URL('../authoring-trellis-persistence.mjs',import.meta.url);
const module=await import(url).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND'&&e.url===url.href)return {};throw e;});
const create=options=>{assert.equal(typeof module.createTrellisAuthoringPersistence,'function','worker must retain ordinary mesh/origin/recovery/levels persistence');return module.createTrellisAuthoringPersistence(options);};
const glb=new Uint8Array([103,108,84,70,2,0,0,0,12,0,0,0]).buffer;
test('real mesh/origin transport retains exact bytes and independent levels failure cannot erase saved result',async()=>{
 const requests=[],levels=[];let current=true;
 const owner=create({request:async(url,options)=>{requests.push({url,options});
  if(url.startsWith('/api/ingest-mesh')){const sha256=createHash('sha256').update(new Uint8Array(options.body)).digest('hex');return {ok:true,json:async()=>({sha256,bytes:options.body.byteLength,source:'/api/read?root=generated-meshes&path='+sha256+'.glb'})};}
  return {ok:true,json:async()=>({result:JSON.parse(options.body)})};},
  loadModule:async()=>{throw Error('levels offline');},levelsStarted:value=>levels.push(value)});
 const out={glb,label:'hinge',generation:{runId:'model-1'}},saved=await owner.persist(out,{assertCurrent(){if(!current)throw Error('stale');}});
 assert.equal(requests.length,2);assert.equal(requests[0].options.body,glb);assert.equal(requests[0].url,'/api/ingest-mesh?role=client-prepares-lods');
 assert.equal(JSON.parse(requests[1].options.body).generation.runId,'model-1');assert.equal(saved.generation.bytes,12);
 assert.equal((await levels[0].promise).phase,'worker');assert.match((await levels[0].promise).error,/levels offline/);
 current=false;await assert.rejects(owner.persist(out,{assertCurrent(){if(!current)throw Error('stale');}}),/stale/);assert.equal(requests.length,2);
 await owner.retire();
});
