// Finish complete retained native WebGPU fields without executing any model.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {extractTrellisDualGridMesh} from './trellis-mesh.js';
import {finishTrellisMesh,encodeTrellisTexturePNG} from './trellis-material.js';
import {NodeTrellisUVWorker} from './node-uv-worker.mjs';
import {persistGenerationAsset,validateGenerationResult,GENERATION_ROUTE} from './sparse-generation-witness-checks.js';

const args=new Map();
for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const output=args.get('--output');
if(!output)throw Error('explicit persistent --output GLB required');
const outputPath=path.resolve(output),out=path.dirname(outputPath),reportPath=path.join(out,'report.json');
const hash=data=>createHash('sha256').update(data).digest('hex');
const report={schema:'trellis2.retained-generation-finishing.v0',status:'running',phase:'argument-admission',
  receiver:args.get('--receiver'),command:process.argv,modelCalls:0,
  route:'retained native WebGPU fields / CPU reference-order finishing / unchanged UV and learned PBR',
  startedAt:new Date().toISOString()};
await fs.mkdir(out,{recursive:true});
const persist=()=>fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
const enter=async phase=>{report.phase=phase;await persist();};
const readTyped=async(file,row,Type,dtype)=>{
  const data=await fs.readFile(file);
  if(row.dtype!==dtype||data.byteLength!==row.byteLength||data.byteLength%4||hash(data)!==row.sha256)
    throw Error('complete unchanged '+dtype+' artifact required: '+file);
  return new Type(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
};
await persist();
try{
  for(const key of ['--repo-root','--expected-commit','--input-root','--expected-native-commit',
    '--python','--source-root','--expected-source-commit','--target-faces','--receiver'])
    if(!args.get(key))throw Error('explicit '+key+' required');
  const root=path.resolve(args.get('--repo-root')),native=path.resolve(args.get('--input-root'));
  const script=fileURLToPath(import.meta.url);
  if(script!==path.join(root,'models/trellis2/finalize-retained-generation.mjs'))throw Error('effective runner root differs from requested repo root');
  report.repoRoot=root;report.inputRoot=native;
  report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  report.dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});
  if(report.commit!==args.get('--expected-commit')||report.dirty)throw Error('exact clean finishing source required');
  const targetFaces=Number(args.get('--target-faces'));
  if(!Number.isSafeInteger(targetFaces)||targetFaces<1)throw Error('positive caller-selected face target required');
  await enter('native-field-admission');
  const rawReport=await fs.readFile(path.join(native,'report.json')),n=JSON.parse(rawReport);
  if(n.status!=='succeeded'||n.result?.status!=='succeeded'||n.commit!==args.get('--expected-native-commit')||n.dirty!==''||
    n.result.effectiveRoute!=='trellis2.image-generation.webgpu.v0'||n.result.backend?.isFallbackAdapter!==false||
    n.result.backend.vendor!=='apple'||n.result.backend.architecture!=='metal-3')
    throw Error('completed exact-source native Apple WebGPU generation required');
  const fixture=await fs.readFile(path.join(n.fixtureRoot,'manifest.json'));
  if(hash(fixture)!==n.fixtureSha256)throw Error('unchanged complete native input manifest required');
  validateGenerationResult(n.result,JSON.parse(fixture));
  report.nativeSessionId=n.nativeSessionId;report.fixtureSha256=n.fixtureSha256;
  report.native={reportSha256:hash(rawReport),commit:n.commit,sessionId:n.nativeSessionId,
    inputManifestSha256:n.fixtureSha256,backend:n.result.backend,comparison:n.result.comparison};
  const fields={};
  for(const [key,Type,dtype]of [['geometry.features',Float32Array,'f32'],['geometry.coordinates',Int32Array,'i32'],
    ['material.features',Float32Array,'f32'],['material.coordinates',Int32Array,'i32']]){
    const row=n.rawOutputs?.[key],observed=n.result.outputs[key];if(!row)throw Error('complete retained field required: '+key);
    if(row.sha256!==observed.sha256||row.byteLength!==observed.byteLength||row.dtype!==observed.dtype)
      throw Error('conflicting retained field receipt: '+key);
    const file=path.join(native,'raw',key+'.'+dtype);
    if(path.resolve(row.path)!==file)throw Error('effective retained field path mismatch: '+key);
    fields[key]=await readTyped(file,row,Type,dtype);
  }
  const rows=fields['geometry.coordinates'].length/3;
  if(!Number.isSafeInteger(rows)||rows<1||fields['geometry.features'].length!==rows*7||
    fields['material.features'].length!==rows*6||fields['material.coordinates'].length!==rows*3||
    n.result.composition?.geometryResolution!==n.result.composition?.materialResolution)
    throw Error('complete guided geometry/material dimensions required');
  report.fields=Object.fromEntries(Object.keys(fields).map(key=>[key,n.rawOutputs[key]]));
  await enter('retained-mesh-extraction');
  const mesh=extractTrellisDualGridMesh({features:fields['geometry.features'],coordinates:fields['geometry.coordinates'],
    resolution:n.result.composition.geometryResolution});
  if(mesh.status!=='surface')throw Error('retained geometry has no surface');
  report.rawMesh={vertices:mesh.vertices.length/3,faces:mesh.triangles.length/3,metadata:mesh.metadata};
  const inputDir=path.join(out,'raw-mesh');await fs.mkdir(inputDir,{recursive:true});
  const row=async(name,values,dtype)=>{
    const data=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);
    await fs.writeFile(path.join(inputDir,name),data);
    return {file:name,dtype,shape:[values.length/3,3],byteLength:data.length,sha256:hash(data)};
  };
  const inputManifest={schema:'trellis2.raw-mesh-input.v0',native:report.native,
    vertices:await row('vertices.f32',mesh.vertices,'float32'),triangles:await row('triangles.u32',mesh.triangles,'uint32')};
  const inputBytes=JSON.stringify(inputManifest,null,2)+'\n';
  await fs.writeFile(path.join(inputDir,'manifest.json'),inputBytes);
  report.rawMesh.inputManifestSha256=hash(inputBytes);
  const cleanupDir=path.join(out,'mesh-postprocess');await fs.mkdir(cleanupDir,{recursive:true});
  const postprocessMesh=async input=>{
    const command=[path.join(root,'models/trellis2/postprocess-retained-mesh.py'),
      '--source-root',path.resolve(args.get('--source-root')),'--expected-source-commit',args.get('--expected-source-commit'),
      '--input',path.join(inputDir,'manifest.json'),'--output',cleanupDir,'--target-faces',String(targetFaces)];
    if(args.get('--keep-largest')==='true')command.push('--keep-largest');
    report.postprocessCommand={python:path.resolve(args.get('--python')),argv:command};await persist();
    const stdout=await fs.open(path.join(cleanupDir,'stdout.log'),'w'),stderr=await fs.open(path.join(cleanupDir,'stderr.log'),'w');
    try{
      const child=spawn(report.postprocessCommand.python,command,{cwd:root,
        env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore',stdout.fd,stderr.fd]});
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{
        report.postprocessExit={code,signal,pid:child.pid};resolve(code);});});
      const raw=await fs.readFile(path.join(cleanupDir,'report.json')),r=JSON.parse(raw);
      report.postprocessReport={path:path.join(cleanupDir,'report.json'),sha256:hash(raw),status:r.status,phase:r.phase};
      if(code!==0||r.status!=='succeeded'||r.modelCalls!==0||r.effectiveRoute!=='Trellis2MLX/reference-cleanup/CPU-fast-simplification'||
        r.source?.commit!==args.get('--expected-source-commit')||r.source.dirty||r.inputManifestSha256!==hash(inputBytes)||r.targetFaces!==targetFaces)
        throw Error('requested source finishing failed: '+(r.error?.message??r.status));
      const vertices=await readTyped(path.join(cleanupDir,r.arrays.vertices.file),r.arrays.vertices,Float32Array,'float32');
      const triangles=await readTyped(path.join(cleanupDir,r.arrays.triangles.file),r.arrays.triangles,Uint32Array,'uint32');
      report.meshPostprocess=r;await persist();
      return {...input,vertices,triangles,metadata:{...input.metadata,postprocess:r}};
    }finally{await stdout.close();await stderr.close();}
  };
  const finished=await finishTrellisMesh(mesh,{postprocessMesh,WorkerClass:NodeTrellisUVWorker,textureSize:1024,
    materialFields:{features:fields['material.features'],coordinates:fields['material.coordinates'],resolution:n.result.composition.materialResolution},
    provenance:{nativeCommit:n.commit,sessionId:n.nativeSessionId,nativeReportSha256:report.native.reportSha256,
      inputManifestSha256:n.fixtureSha256,postprocessCommit:report.commit,comparison:n.result.comparison,
      route:GENERATION_ROUTE,input:'retained complete WebGPU fields / explicit CPU finalizer; no inference'},onPhase:e=>enter(e.phase)});
  report.uv=finished.mesh.uvMetadata;
  report.texture={width:finished.textures.width,height:finished.textures.height,coveredPixels:finished.textures.coveredPixels,metadata:finished.textures.metadata};
  await enter('finished-asset-admission');
  const bytes=new Uint8Array(finished.glb);
  await persistGenerationAsset({report,bytes,outputPath,write:(file,data)=>fs.writeFile(file,data),persist});
  for(const [name,pixels]of [['base-color',finished.textures.baseColor],['metallic-roughness',finished.textures.metallicRoughness]])
    await fs.writeFile(path.join(out,name+'.png'),new Uint8Array(await encodeTrellisTexturePNG({pixels,width:1024,height:1024})));
  report.status='succeeded';report.phase=null;
}catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await persist();
  console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,rawMesh:report.rawMesh,
    cleanedFaces:report.meshPostprocess?.outputFaces,asset:report.assetArtifact,report:reportPath}));}
