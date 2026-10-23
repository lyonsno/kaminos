// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {identifyMetalGlb,admitMetalReceipt} from '../metal-remesh-finishing.mjs';
import {GENERATION_ROUTE} from '../sparse-generation-witness-checks.js';
import {encodeTrellisTexturePNG} from '../trellis-material.js';
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
test('source PNG buffer views exclude observed Trimesh alignment spaces without changing binary bytes',async()=>{
 let png;
 for(let width=1;width<=4;width++){
  const pixels=Uint8Array.from({length:width*4},(_,i)=>(i*37+11)%256);
  const candidate=Buffer.from(await encodeTrellisTexturePNG({pixels,width,height:1}));
  if(candidate.length%4){png=candidate;break;}
 }
 assert.ok(png,'fixture has actual PNG alignment padding');
 const binary=Buffer.alloc(Math.ceil(png.length/4)*4,32);png.copy(binary);
 const raw=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[{byteLength:binary.length}],
  bufferViews:[{buffer:0,byteOffset:0,byteLength:binary.length}],images:[{mimeType:'image/png',bufferView:0}]}));
 const json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
 const h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+binary.length,8);
 h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);
 const bh=Buffer.alloc(8);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4);
 const original=Buffer.concat([h,json,bh,binary]);
 const result=Buffer.from(identifyMetalGlb(original,provenance)),length=result.readUInt32LE(12),doc=JSON.parse(result.subarray(20,20+length));
 assert.equal(doc.bufferViews[0].byteLength,png.length,'consumer image view ends exactly at PNG IEND, not at source padding');
 assert.deepEqual(result.subarray(28+length),binary,'original PNG and padding bytes remain exact');
 const bad=Buffer.from(original);bad[bad.length-1]=255;
 assert.throws(()=>identifyMetalGlb(bad,provenance),/PNG|padding/,'non-alignment trailing data must not be hidden');
});
