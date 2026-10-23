// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {identifyMetalGlb,admitMetalReceipt} from '../metal-remesh-finishing.mjs';
import {GENERATION_ROUTE} from '../sparse-generation-witness-checks.js';
const hash='a'.repeat(64),revision='b'.repeat(40),provenance={sessionId:'observed-session',inputManifestSha256:hash,route:GENERATION_ROUTE};
function glb(){
 const raw=Buffer.from(JSON.stringify({asset:{version:'2.0'},extras:{retained:'source metadata'},buffers:[{byteLength:4}]}));
 const json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
 const h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(32+json.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);
 const bin=Buffer.from([4,0,0,0,66,73,78,0,8,6,7,5]);return Buffer.concat([h,json,bin]);
}
test('generation identity changes JSON only, preserving every original binary byte',()=>{
 const original=glb(),identified=Buffer.from(identifyMetalGlb(original,provenance));
 const length=identified.readUInt32LE(12),doc=JSON.parse(identified.subarray(20,20+length));
 assert.deepEqual(identified.subarray(20+length),original.subarray(20+original.readUInt32LE(12)));
 assert.equal(doc.extras.retained,'source metadata');assert.deepEqual(doc.extras.trellis.provenance,provenance);
 assert.equal(identified.readUInt32LE(8),identified.length);
 for(const bytes of [Buffer.from(original.subarray(0,24)),Buffer.from(original)]){
  bytes.writeUInt32LE(0,0);assert.throws(()=>identifyMetalGlb(bytes,provenance),/complete original/);
 }
 assert.throws(()=>identifyMetalGlb(original,{...provenance,sessionId:null}),/provenance/);
});
const request={sourceRoot:'/source',sourceCommit:revision,gridSize:512,targetFaces:1000000,textureSize:4096,band:1,projectBack:0,
 meshSha256:hash,materialSha256:hash,backendSha256:hash};
const receipt=()=>({status:'complete',source:{root:'/source',commit:revision,dirty:''},modelCalls:0,
 inputs:{meshManifestSha256:hash,materialManifestSha256:hash,meshSha256:hash,textureSha256:hash},
 finishing:{status:'complete',source:{root:'/source',revision},backend_manifest_sha256:hash,
 requested:{mesh_sha256:hash,texture_sha256:hash},effective:{grid_size:512,target_faces:1000000,texture_size:4096,band:1,project_back:0,
 accelerator:'Metal custom kernels',host_tensors:'torch-cpu'},stages:['raw','filled_original','rebuilt','reduced','uv','normals'].map(name=>({name}))}});
test('receipt rejects fallback, stale input/source, partial output phases and silently defaulted settings',()=>{
 assert.equal(admitMetalReceipt(receipt(),request).status,'complete');
 for(const mutate of [r=>r.source.commit='0'.repeat(40),r=>r.inputs.materialManifestSha256='0'.repeat(64),
   r=>r.modelCalls=1,r=>r.finishing.effective.accelerator='CPU fallback',r=>r.finishing.effective.project_back=.9,
   r=>r.finishing.stages.pop(),r=>r.finishing.status='failed',r=>r.finishing.backend_manifest_sha256='0'.repeat(64)]){
  const r=receipt();mutate(r);assert.throws(()=>admitMetalReceipt(r,request),/Metal/);
 }
});
