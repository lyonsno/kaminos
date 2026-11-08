// Saved latent -> production coarse decoder -> the product voxel-history format.
// Never runs the image encoder, denoising transformer, or fine geometry decoder.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createGpuTestContext} from '@kaminos/shader-herder';
import {createWebGpuInferenceSession,WEBGPU_BUFFER_USAGE as U} from '../../webgpu-inference-kit/src/core.js';
import {createTrellisSparseDecoderAdapter,buildSparseDecoderPlan,SPARSE_DECODER_ROUTE} from './sparse-decoder.js';
import {validateDecoderFixture} from './sparse-decoder-witness-checks.js';
import {createTrellisOccupancyCoordinatesAdapter,readTrellisOccupancyPreview} from './occupancy-coordinates.js';
import {VOXEL_HISTORY_SCHEMA,voxelFrameFromPreview} from './voxel-history.js';

const args=process.argv.slice(2),input=args[args.indexOf('--input')+1],out=args[args.indexOf('--out')+1];
if(!args.includes('--input')||!args.includes('--out')||!input||!out)throw Error('Use --input request.json --out chosen-directory');
await fs.mkdir(out,{recursive:true});
const report={schema:'trellis2.voxel-replay-report.v1',status:'failed',phase:'request',input:path.resolve(input),out:path.resolve(out),denoisingModelCalls:0,fineGeometryDecoderCalls:0,frames:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
const persist=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await persist();
let gpu,session,decoder,coordinates;
try{
 const requestBytes=await fs.readFile(input),request=JSON.parse(requestBytes);
 if(request.schema!=='trellis2.voxel-replay-request.v1'||!request.repoRoot||!request.expectedCommit||!Array.isArray(request.frames)||!request.frames.length)throw Error('Complete replay request required');
 const root=path.resolve(request.repoRoot),git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8'}).trim();
 if(git('rev-parse','HEAD')!==request.expectedCommit)throw Error('Replay source revision differs from request');
 if(path.resolve(import.meta.dirname,'../..')!==root)throw Error('Replay executable differs from explicit repo root');
 report.requestSha256=hash(requestBytes);report.source={root,commit:request.expectedCommit,dirty:!!git('status','--porcelain'),modules:{}};
 const sourceFiles=['models/trellis2/replay-voxel-history.mjs','models/trellis2/voxel-history.js','models/trellis2/sparse-decoder.js','models/trellis2/occupancy-coordinates.js','webgpu-inference-kit/src/core.js'];
 for(const file of sourceFiles)report.source.modules[file]=hash(await fs.readFile(path.join(root,file)));
 async function manifest(item){const raw=await fs.readFile(path.join(item.root,'manifest.json'));if(hash(raw)!==item.sha256)throw Error('Changed retained manifest');return JSON.parse(raw);}
 const fixture=await manifest(request.decoder),plan=validateDecoderFixture(fixture),weights={};
 async function tensor(root,row){
  if(!row||path.basename(row.file)!==row.file||row.dtype!=='float32')throw Error('Observed F32 tensor required');
  const raw=await fs.readFile(path.join(root,row.file));if(raw.length!==row.byteLength||hash(raw)!==row.sha256)throw Error('Partial or changed retained tensor '+row.file);
  const array=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length));if(!array.every(Number.isFinite))throw Error('Nonfinite retained tensor');return array;
 }
 report.phase='retained-inputs';await persist();
 for(const [name,row]of Object.entries(fixture.tensors))if(name.startsWith('weight.'))weights[name.slice(7)]=await tensor(request.decoder.root,row);
 const frames=[];
 for(const spec of request.frames){const m=await manifest(spec.fixture),row=m.tensors?.[spec.tensor],sample=await tensor(spec.fixture.root,row);
  if(JSON.stringify(row.shape)!==JSON.stringify(plan.inputShape))throw Error('Wrong retained latent shape');
  frames.push({spec,sample,provenance:{manifestSha256:spec.fixture.sha256,tensor:spec.tensor,tensorSha256:row.sha256,samplingSource:m.source,samplingProducer:m.producer,sourceRoute:m.referenceRoute}});}
 const history={schema:VOXEL_HISTORY_SCHEMA,runId:request.runId,label:request.label,source:{kind:'retained-reference-replay',clock:'presentation-sequence',requestSha256:report.requestSha256,
  decoder:{source:report.source,checkpoint:fixture.checkpoint,manifestSha256:request.decoder.sha256},note:'Saved MLX trajectory decoded by current production WebGPU coarse decoder; no new denoising'},status:'capturing',frames:[]};
 report.phase='native-device';await persist();gpu=await createGpuTestContext();report.backend=gpu.adapterInfo;
 if(gpu.adapterInfo.isFallbackAdapter!==false||gpu.adapterInfo.vendor!=='apple')throw Error('Nonfallback Apple GPU required');
 session=await createWebGpuInferenceSession({sessionId:'trellis-voxel-replay:'+request.runId,device:gpu.device,queue:gpu.device.queue,deviceOwnership:'borrowed',adapterName:gpu.adapterInfo.description||gpu.adapterInfo.device});
 const route=await session.registerRoute({routeId:SPARSE_DECODER_ROUTE,runtimeOptions:{requiredStages:[...plan.stages,'occupancy-max-any','occupancy-coordinate-compact'],kernel:{profile:'trellis2-voxel-history-replay-f32'}}});
 report.requestedRoute=SPARSE_DECODER_ROUTE;report.effectiveRoute=route.routeId;if(route.routeId!==SPARSE_DECODER_ROUTE)throw Error('Wrong effective replay route');
 decoder=createTrellisSparseDecoderAdapter({route,config:fixture.config,weights});
 for(const {spec,sample,provenance}of frames){
  report.phase='coarse-decoding:'+spec.id;await persist();
  const job=route.enqueue({jobId:request.runId+':'+spec.id,execute:async invocation=>{
   await decoder.run({sample},invocation);
   coordinates=createTrellisOccupancyCoordinatesAdapter({route,resolution:plan.outputResolution,logitsTensor:decoder.outputs.logits});
   await coordinates.run(invocation);const rows=await coordinates.coordinates(invocation);
   return readTrellisOccupancyPreview({runtime:route.runtime,coordinates:rows,plan:coordinates.plan,runId:request.runId,routeId:route.routeId,steps:spec.steps,invocation});
  }});
  const completion=await job.completion;if(completion.status!=='succeeded')throw Error(completion.failure?.message||'Coarse replay failed');
  const preview=completion.output,frame=voxelFrameFromPreview({...preview,step:spec.step},{id:spec.id,atSeconds:spec.atSeconds,state:spec.state,provenance});
  const bytes=new Uint8Array(preview.coordinates.buffer),file=hash(Buffer.from(frame.id))+'.i32';await fs.writeFile(path.join(out,file),bytes);
  frame.coordinates={file,byteLength:bytes.length,sha256:hash(bytes)};history.frames.push(frame);report.frames.push({id:frame.id,count:frame.count,state:frame.state,step:frame.step,sha256:frame.coordinates.sha256});
  await fs.writeFile(path.join(out,'history.json'),JSON.stringify(history,null,2)+'\n');coordinates.dispose();coordinates=null;
 }
 history.status='completed';await fs.writeFile(path.join(out,'history.json'),JSON.stringify(history,null,2)+'\n');
 for(const file of sourceFiles)if(hash(await fs.readFile(path.join(root,file)))!==report.source.modules[file])throw Error('Replay source module changed during execution: '+file);
 report.status='succeeded';report.phase='complete';report.history={file:'history.json',runId:history.runId,frames:history.frames.length};
}catch(error){report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 for(const [name,cleanup]of [['coordinates',()=>coordinates?.dispose()],['decoder',()=>decoder?.dispose()],['session',async()=>{if(session){await session.drain();session.close();}}],['device',()=>gpu?.destroy()]])try{await cleanup();}catch(e){report.status='failed';(report.cleanupErrors??=[]).push({name,error:e.message});process.exitCode=1;}
 report.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({status:report.status,phase:report.phase,frames:report.frames,error:report.error,out}));
}
