import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadMicroField} from '../neural-microstructure-field.mjs';
import {decodeFieldGpu} from './microstructure-field-gpu.mjs';
import {withKaminosGpu} from './shader-herder.mjs';
const {values:a}=parseArgs({options:{model:{type:'string'},output:{type:'string'},python:{type:'string'}}});
if(!a.output)throw Error('--output required for durable failure reporting');
await fs.mkdir(a.output,{recursive:true});
const report={ok:false,phase:'inputs',schema:'kaminos.microstructure-field-conformance.v1',requested:a,repoRoot:process.cwd()};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  if(!a.model||!a.python)throw Error('--model and --python required');
  const modelBytes=await fs.readFile(path.join(a.model,'model.json'));report.modelSHA256=sha(modelBytes);
  const model=await loadMicroField(new URL('file://'+path.resolve(a.model)+'/'),{fetcher:async url=>{const b=await fs.readFile(url);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}});
  const packed=path.join(a.output,'heldout-inputs.f32');
  const extraction=spawnSync(a.python,['-c',"import numpy as np,sys; d=np.load(sys.argv[1]); p=np.concatenate([d['positions'],d['carriers'][:,None]],axis=1).astype('<f4'); p.tofile(sys.argv[2]); print(len(p))",path.join(a.model,'heldout.npz'),packed],{encoding:'utf8'});
  if(extraction.status!==0)throw Error(`Retained input extraction failed: ${extraction.stderr}`);
  const inputBytes=await fs.readFile(packed),referenceBytes=await fs.readFile(path.join(a.model,'heldout-predictions.f32'));
  const floats=b=>new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  const points=floats(inputBytes),reference=floats(referenceBytes);
  if(points.length%4||reference.length!==points.length/4*9||!reference.every(Number.isFinite))throw Error('Retained prediction/input shape or finiteness differs');
  report.samples=points.length/4;report.inputsSHA256=sha(inputBytes);report.referenceSHA256=sha(referenceBytes);report.sourceSHA256=model.meta.sourceSHA256;report.phase='gpu';
  await withKaminosGpu(async ctx=>{
    const prediction=await decodeFieldGpu(ctx,model,points);report.phase='compare';
    if(!prediction.every(Number.isFinite))throw Error('Nonfinite WebGPU prediction');
    const max=Array(9).fill(0),squared=Array(9).fill(0);
    for(let i=0;i<reference.length;i++){const channel=i%9,d=Math.abs(prediction[i]-reference[i]);max[channel]=Math.max(max[channel],d);squared[channel]+=d*d;}
    report.channels=model.meta.output.map((name,i)=>({name,maxAbsoluteError:max[i],rmse:Math.sqrt(squared[i]/report.samples)}));
    await fs.writeFile(path.join(a.output,'webgpu-predictions.f32'),new Uint8Array(prediction.buffer));
    report.toleranceAbsolute=1e-3;
    if(max.some(d=>d>report.toleranceAbsolute))throw Error('WebGPU and retained MLX decoder disagree');
  },{onEvidence:e=>{report.runtime=e;}});
  if(report.runtime?.route!=='hardware')throw Error('Actual hardware decoder execution required');
  report.ok=true;report.phase='done';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await fs.writeFile(path.join(a.output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
