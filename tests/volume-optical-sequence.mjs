// kaminos-test: node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadOpticalSequence,validateOpticalSequence} from '../volume-optical-sequence.mjs';
const field=new Float32Array([1,.5,.2,.4]),flow=new Float32Array(3);
const entry=(path,data)=>({path,sha256:createHash('sha256').update(Buffer.from(data.buffer)).digest('hex')});
const manifest={schema:'kaminos.optical-sequence.v1',status:'captured',basis:'cie-xyz-d65',source:{backend:'WebGPU:apple',presetId:'observed-preset',commit:'observed-source'},dimensions:[1,1,1],bounds:[[0,0,0],[1,1,1]],frames:[{step:3,optical:entry('optical.f32',field),velocity:entry('flow.f32',flow)}]};
assert.throws(()=>validateOpticalSequence({...manifest,dimensions:[0,1,1]}),/dimensions/);
assert.throws(()=>validateOpticalSequence({...manifest,source:{...manifest.source,backend:'fallback'}}),/source identity/);
assert.throws(()=>validateOpticalSequence({...manifest,frames:[manifest.frames[0],manifest.frames[0]]}),/increasing/);
const seen=[];
const fetcher=async url=>{
 const u=new URL(url);seen.push(u);const path=u.searchParams.get('path');
 if(path==='study/manifest.json')return new Response(JSON.stringify(manifest));
 if(path==='study/optical.f32')return new Response(field);
 if(path==='study/flow.f32')return new Response(flow);
 return new Response('missing',{status:404});
};
const url='http://localhost/api/read?root=scenes&path=study%2Fmanifest.json';
const loaded=await loadOpticalSequence(url,fetcher);
assert.deepEqual(loaded.frames[0].optical,field);
assert.equal(seen[1].searchParams.get('root'),'scenes');
assert.equal(seen[1].searchParams.get('path'),'study/optical.f32','Fields must stay on the manifest mounted root');
await assert.rejects(()=>loadOpticalSequence(url,async u=>String(u).includes('manifest')?new Response(JSON.stringify(manifest)):new Response(new Float32Array(1))),/Incomplete/);
await assert.rejects(()=>loadOpticalSequence(url,async u=>String(u).includes('manifest')?new Response(JSON.stringify(manifest)):new Response(new Float32Array(4))),/hash mismatch/);
console.log('Retained optical sequence identity, mounted paths, completeness and hash checks passed');
