import assert from 'node:assert/strict';
import {createStoneObservationRuntime} from '../structural-material-observation-runtime.mjs';
const ref={version:'run'},resource={schema:'stone-observation-resource-v1',version:'run',pieces:[{id:0,geometry:{indices:[0,1,2]},binding:{route:'fixed'}}]},dynamic={runId:'run',pieces:[{id:0,renderedPositions:[1,2,3]}]};
const calls=[],cache=new Map(),stamp={schema:'stone-observation-stamp-v1',route:'kaminos.picked-stone.bounded-shards.webgpu.v0',runId:'run',resourceVersion:'run',steps:1,paused:true,busy:false,pendingPick:false,finishing:false,failure:null,digest:'a'.repeat(64)};
const resources={async retain({version,read}){if(!cache.has(version)){await read();cache.set(version,ref);}return cache.get(version);}};
const runtime=createStoneObservationRuntime({resources,resourceDirectory:'/caller/resources',call:async code=>{
 calls.push(code);if(code.includes('observationStamp'))return structuredClone(stamp);
 if(code.includes('observationResources'))return JSON.stringify(resource);
 if(code.includes('witness({resources:false})'))return JSON.stringify(dynamic);
 throw new Error('Unexpected browser request');
}});
for(let i=0;i<2;i++){
 const result=await runtime.read();assert.equal(result.pieces[0].geometry,undefined);assert.deepEqual(result.resource,{directory:'/caller/resources',reference:ref});
 assert.deepEqual(runtime.reconstruct(result).pieces[0],{...dynamic.pieces[0],...resource.pieces[0]});
}
assert.equal(runtime.acquisitions(),1);assert.equal(calls.filter(s=>s.includes('observationResources')).length,1);
assert.equal(calls.filter(s=>s==='window.__stoneShards.surfacePositions()').length,0,'Native surface arrays never cross browser boundary just to be discarded');
assert.throws(()=>runtime.stability.assertStable(stamp,{...stamp,digest:'b'.repeat(64)}),/changed/);
dynamic.runId='wrong';await assert.rejects(runtime.read(),/changed/);
console.log('Once-only source acquisition, complete dynamic reference reconstruction, and stale capture rejection pass');
