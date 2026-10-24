// The original native Metal finisher is a separate, explicitly selected backend.
// Inference remains WebGPU; this module does not claim browser-local remeshing.
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {GENERATION_ROUTE} from './sparse-generation-witness-checks.js';
export const METAL_REMESH_ROUTE='Trellis2MLX/original-remesh/Metal';
export function validateMetalFinishing(value){
  if(!value||typeof value!=='object')throw Error('explicit Metal finishing configuration required');
  for(const key of ['python','backendManifest'])
    if(typeof value[key]!=='string'||!path.isAbsolute(value[key]))throw Error('absolute Metal '+key+' required');
  if(!Array.isArray(value.pythonPath)||!value.pythonPath.every(p=>typeof p==='string'&&path.isAbsolute(p)))
    throw Error('explicit absolute Metal pythonPath list required');
  if(!Number.isFinite(value.band)||value.band<=0||!Number.isFinite(value.projectBack)||value.projectBack<0||value.projectBack>1)
    throw Error('positive remesh band and projectBack in [0,1] required');
  return value;
}
// Add the existing generation admission envelope without touching geometry,
// images, binary bytes, or the retained original source-exported GLB.
export function identifyMetalGlb(input,provenance){
  const bytes=Buffer.from(input),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<28||v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==bytes.length||v.getUint32(16,true)!==0x4e4f534a)
    throw Error('complete original Metal GLB required');
  const length=v.getUint32(12,true),end=20+length;
  if(end+8>bytes.length||v.getUint32(end+4,true)!==0x004e4942||v.getUint32(end,true)!==bytes.length-end-8)
    throw Error('complete original Metal binary chunk required');
  if(!provenance?.sessionId||!/^[a-f0-9]{64}$/.test(provenance.inputManifestSha256??'')||provenance.route!==GENERATION_ROUTE)
    throw Error('identified current Metal generation provenance required');
  const doc=JSON.parse(bytes.subarray(20,end).toString('utf8'));
  // Observed Trimesh source exports count 0–3 alignment spaces inside PNG
  // buffer views. Keep the exact BIN (and original export), but describe only
  // PNG bytes to the normal strict asset-admission consumer.
  for(const image of doc.images??[]){
    if(image.mimeType!=='image/png')continue;
    const view=doc.bufferViews?.[image.bufferView],offset=view?.byteOffset??0;
    if(view?.buffer!==0||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(view.byteLength)||view.byteLength<20||end+8+offset+view.byteLength>bytes.length)
      throw Error('complete source PNG buffer view required');
    const png=bytes.subarray(end+8+offset,end+8+offset+view.byteLength);
    if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('source PNG signature required');
    let position=8,complete=false;
    while(position+12<=png.length){
      const size=png.readUInt32BE(position),type=png.subarray(position+4,position+8).toString('ascii');
      if(position+12+size>png.length)throw Error('complete source PNG chunks required');
      position+=12+size;
      if(type==='IEND'){
        const padding=png.length-position;
        if(size!==0||padding>3||(padding&&png.length%4)||!png.subarray(position).every(byte=>byte===32))
          throw Error('unexpected source PNG trailing padding');
        view.byteLength=position;complete=true;break;
      }
    }
    if(!complete)throw Error('complete source PNG IEND required');
  }
  doc.extras={...doc.extras,trellis:{stage:'learned-geometry-and-material',provenance}};
  const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);
  const header=Buffer.alloc(20);bytes.copy(header,0,0,12);
  header.writeUInt32LE(20+padded.length+bytes.length-end,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
  return new Uint8Array(Buffer.concat([header,padded,bytes.subarray(end)]));
}
export function admitMetalReceipt(r,{sourceRoot,sourceCommit,gridSize,targetFaces,textureSize,band,projectBack,meshSha256,materialSha256,backendSha256}){
  if(r?.status!=='complete'||r.source?.root!==sourceRoot||r.source?.commit!==sourceCommit||r.source.dirty||r.modelCalls!==0||
    r.inputs?.meshManifestSha256!==meshSha256||r.inputs?.materialManifestSha256!==materialSha256)
    throw Error('original Metal source/current-input receipt mismatch');
  const s=r.finishing;
  if(s?.status!=='complete'||s.source?.root!==sourceRoot||s.source?.revision!==sourceCommit||s.backend_manifest_sha256!==backendSha256||
    s.effective?.grid_size!==gridSize||s.effective?.target_faces!==targetFaces||s.effective?.texture_size!==textureSize||
    s.effective?.band!==band||s.effective?.project_back!==projectBack||s.effective?.accelerator!=='Metal custom kernels'||
    s.effective?.host_tensors!=='torch-cpu'||s.requested?.mesh_sha256!==r.inputs.meshSha256||s.requested?.texture_sha256!==r.inputs.textureSha256||
    !/^[a-f0-9]{64}$/.test(r.inputs.meshSha256??'')||!/^[a-f0-9]{64}$/.test(r.inputs.textureSha256??'')||
    s.stages?.map(s=>s.name).join(',')!=='raw,filled_original,rebuilt,reduced,uv,normals')
    throw Error('original Metal effective route/settings/stages differ from selection');
  return s;
}
export async function finishWithSourceMetal({root,sourceRoot,sourceCommit,python,backendManifest,pythonPath,band,projectBack,
  meshInput,materialInput,gridSize,targetFaces,textureSize,outputDir,provenance,record,persist,spawnCommand=spawn}){
  validateMetalFinishing({python,backendManifest,pythonPath,band,projectBack});
  const manifest=path.join(outputDir,'material-input.json');await fs.mkdir(outputDir,{recursive:true});
  const materialBytes=JSON.stringify(materialInput,null,2)+'\n';await fs.writeFile(manifest,materialBytes);
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const bindings={meshSha256:digest(await fs.readFile(meshInput)),materialSha256:digest(materialBytes),backendSha256:digest(await fs.readFile(backendManifest))};
  const command=[path.join(root,'models/trellis2/finish-retained-metal.py'),
    '--source-root',sourceRoot,'--expected-source-commit',sourceCommit,'--mesh-input',meshInput,
    '--material-input',manifest,'--grid-size',String(gridSize),'--target-faces',String(targetFaces),
    '--texture-size',String(textureSize),'--band',String(band),'--project-back',String(projectBack),
    '--backend-manifest',backendManifest,'--output-dir',outputDir];
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:[sourceRoot,...pythonPath].join(path.delimiter)};
  record.metalCommand={python,argv:command,pythonPath:env.PYTHONPATH};await persist();
  const stdout=await fs.open(path.join(outputDir,'stdout.log'),'w'),stderr=await fs.open(path.join(outputDir,'stderr.log'),'w');
  try{
    const child=spawnCommand(python,command,{cwd:root,env,stdio:['ignore',stdout.fd,stderr.fd]});
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    record.metalExit=exit;
    const r=JSON.parse(await fs.readFile(path.join(outputDir,'report.json'),'utf8'));
    record.metalReport=r;await persist();
    if(exit.code!==0||r.status!=='complete'||r.source?.commit!==sourceCommit||r.source.dirty||r.modelCalls!==0)
      throw Error('original Metal finishing failed: '+(r.error??r.status));
    const s=admitMetalReceipt(r,{sourceRoot,sourceCommit,gridSize,targetFaces,textureSize,band,projectBack,...bindings});
    const expected=path.join(outputDir,'finishing','output.glb');
    if(s.output?.path!==expected)throw Error('original Metal output path differs from current run');
    const original=await fs.readFile(expected);
    if(original.length!==s.output.size_bytes||createHash('sha256').update(original).digest('hex')!==s.output.sha256)
      throw Error('changed or incomplete original Metal output');
    return {bytes:identifyMetalGlb(original,provenance),receipt:r};
  }finally{await stdout.close();await stderr.close();}
}
