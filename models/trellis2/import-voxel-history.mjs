// File-in / receipt-out entry for the same history endpoint used by live runs.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {validateVoxelHistory,validateVoxelFrame,coordinatesBase64} from './voxel-history.js';
import {verifyAuthoringServer} from '../../scene-authoring-witness-identity.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const input=args.get('--input'),out=args.get('--out'),server=args.get('--server'),root=args.get('--repo-root');
if(!input||!out||!server||!root)throw Error('Use --input history.json --out receipt.json --server URL --repo-root checkout [--asset support.glb]');
await fs.mkdir(path.dirname(out),{recursive:true});const report={status:'failed',phase:'source',input:path.resolve(input),server,repoRoot:root};
const write=()=>fs.writeFile(out,JSON.stringify(report,null,2)+'\n');await write();
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
 report.serving=await verifyAuthoringServer({origin:server,repoRoot:root});const raw=await fs.readFile(input),history=validateVoxelHistory(JSON.parse(raw));report.inputSha256=hash(raw);
 const post=async(route,body,type='application/json')=>{const r=await fetch(new URL(route,server),{method:'POST',headers:{'Content-Type':type},body});const v=await r.json();if(!r.ok)throw Error(v.error||'Import HTTP '+r.status);return v;};
 report.phase='frames';report.frames=[];await write();
 for(const frame of history.frames){
  if(typeof frame.coordinates.file!=='string'||path.basename(frame.coordinates.file)!==frame.coordinates.file)throw Error('Frame file must be inside its history bundle');
  const bytes=await fs.readFile(path.join(path.dirname(input),frame.coordinates.file));
  if(bytes.length!==frame.coordinates.byteLength||hash(bytes)!==frame.coordinates.sha256)throw Error('Retained frame bytes differ');
  const rows=new Int32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));validateVoxelFrame(frame,rows);
  const result=await post('/api/trellis-history',JSON.stringify({schema:history.schema,runId:history.runId,label:history.label,source:history.source,frame,coordinatesBase64:coordinatesBase64(rows)}));
  if(result.runId!==history.runId||result.frameId!==frame.id)throw Error('History storage returned another identity');report.frames.push(result);await write();
 }
 await post('/api/trellis-history',JSON.stringify({schema:history.schema,runId:history.runId,label:history.label,source:history.source,status:history.status,gaps:history.gaps??[]}));
 if(args.has('--asset')){
  report.phase='asset-association';await write();const glb=await fs.readFile(args.get('--asset'));
  if(glb.readUInt32LE(0)!==0x46546c67||glb.readUInt32LE(8)!==glb.length||glb.readUInt32LE(16)!==0x4e4f534a)throw Error('Complete support GLB required');
  const doc=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString()),support=doc.extras?.trellis?.preview,last=history.frames.at(-1);
  if(history.source.kind!=='retained-reference-replay'||support?.coordinates?.sha256!==last.coordinates.sha256||support.count!==last.count)throw Error('Coarse asset does not belong to this retained support history');
  const saved=await post('/api/ingest-mesh?role=client-prepares-lods',glb,'model/gltf-binary');if(saved.sha256!==hash(glb)||saved.bytes!==glb.length)throw Error('Asset ingestion changed the coarse artifact');
  const generation={schema:'kaminos.asset-generation.v1',runId:history.runId,route:history.source.decoder?.routeId??'trellis2.sparse-decoder.webgpu.v0',kind:'retained-reference-replay',
   input:{kind:'retained-latent-trajectory',sha256:last.provenance.tensorSha256},sha256:saved.sha256,bytes:saved.bytes,receiptValidation:{ok:true,basis:'observed production coarse replay, exact retained support digest'},
   history:{schema:history.schema,runId:history.runId,source:'/api/trellis-history?'+new URLSearchParams({runId:history.runId})},provenance:history.source};
  const result={...saved,name:history.label+'.glb',generation};await post('/api/mesh-generation-origin',JSON.stringify(result));report.asset=result;
 }
 report.historyUrl=new URL('/index.html?'+new URLSearchParams({workspace:'workbench',experiment:'trellis-history',experiment_inputs:JSON.stringify({runId:history.runId,assetSource:report.asset?.source??null})}),server).href;
 report.status='succeeded';report.phase='complete';
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await write();console.log(JSON.stringify({status:report.status,phase:report.phase,historyUrl:report.historyUrl,error:report.error}));}
