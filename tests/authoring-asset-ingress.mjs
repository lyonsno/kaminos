// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthoringAssetIngress} from '../authoring-asset-ingress.mjs';

const file=new File([new Uint8Array([1,2,3,4])],'local burner.glb',{type:'model/gltf-binary'});
const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())).toString('hex');
const receipt={schema:'kaminos.generated-mesh.v0',sha256,bytes:4,source:`/api/read?root=generated-meshes&path=${sha256}.glb`};
test('GLB ingress consumes the existing content-addressed mesh receipt and retains the local name',async()=>{
 const calls=[],ingress=createAuthoringAssetIngress({request:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>receipt};}});
 const saved=await ingress.uploadMesh(file);assert.equal(calls[0].url,'/api/ingest-mesh');assert.deepEqual([...new Uint8Array(calls[0].options.body)],[1,2,3,4]);
 assert.equal(saved.source,receipt.source);assert.equal(saved.sha256,sha256);assert.equal(saved.name,file.name);assert.equal(saved.label,'local burner');assert.equal(saved.kind,'mesh');
});
test('mesh persistence must identify the exact bytes and source, not a fallback or partial save',async()=>{
 for(const value of [{...receipt,sha256:'a'.repeat(64)},{...receipt,bytes:3},{...receipt,source:'/other.glb'},{...receipt,schema:'fallback'},{}]){
  const ingress=createAuthoringAssetIngress({request:async()=>({ok:true,json:async()=>value})});await assert.rejects(ingress.uploadMesh(file),/different artifact/);
 }
 const ingress=createAuthoringAssetIngress({request:async()=>({ok:false,json:async()=>({error:'disk full'})})});await assert.rejects(ingress.uploadMesh(file),/disk full/);
});
test('stale preparation never issues a mesh POST; a write already sent is not claimed rolled back',async()=>{
 let current=true,posts=0;const assertCurrent=()=>{if(!current)throw Object.assign(Error('stale upload'),{name:'AbortError'});};
 const ingress=createAuthoringAssetIngress({request:async()=>{posts++;current=false;return {ok:true,json:async()=>receipt};}});
 current=false;await assert.rejects(ingress.uploadMesh(file,{assertCurrent}),/stale upload/);assert.equal(posts,0);
 current=true;await assert.rejects(ingress.uploadMesh(file,{assertCurrent}),/stale upload/);assert.equal(posts,1);
});
