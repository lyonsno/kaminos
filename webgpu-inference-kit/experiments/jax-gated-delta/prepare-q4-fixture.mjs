import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {q4Fixture} from './q4-reference.mjs';

const {values:a}=parseArgs({options:{source:{type:'string'},'qwen-root':{type:'string'},'qwen-commit':{type:'string'},out:{type:'string'}}});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(!a.out)throw new Error('--out must name the caller-owned fixture');
let report={status:'failed',phase:'input',requested:a};
const save=async()=>{await fs.mkdir(path.dirname(path.resolve(a.out)),{recursive:true});await fs.writeFile(a.out,JSON.stringify(report,null,2)+'\n');};
try{
  await save();
  const root=path.resolve(a.source),metaBytes=await fs.readFile(path.join(root,'meta.json')),meta=JSON.parse(metaBytes);
  const row=meta.affine.find(x=>x.name==='a');
  if(row?.group!==64||row.columns!==4096||row.rows!==32||row.tokens!==5)throw new Error('unexpected observed reference layout');
  const arrays={};report.phase='source-digests';
  for(const name of ['weight','scales','biases','input','output']){
    const entry=meta.arrays['affine-a.'+name],shape={weight:[32,512],scales:[32,64],biases:[32,64],input:[5,4096],output:[5,32]}[name];
    if(entry?.dtype!==(name==='weight'?'u32':'f32')||entry?.shape?.length!==shape.length||shape.some((x,i)=>entry.shape[i]!==x)||entry.bytes!==shape.reduce((a,b)=>a*b,4))
      throw new Error('reference array layout '+name);
    const bytes=await fs.readFile(path.join(root,entry.file));
    if(sha(bytes)!==entry.sha256||bytes.length!==entry.bytes)throw new Error('source digest mismatch '+name);
    arrays[name]=Array.from({length:bytes.length/4},(_,i)=>name==='weight'?bytes.readUInt32LE(i*4):bytes.readFloatLE(i*4));
  }
  const f=q4Fixture({tokens:1,columns:row.columns,rows:1,rank:2,alpha:2});
  f.params.input=arrays.input.slice(0,row.columns);f.params.b.fill(0);
  f.base={packed:arrays.weight.slice(0,row.columns/8),scales:arrays.scales.slice(0,row.columns/64),biases:arrays.biases.slice(0,row.columns/64)};
  report.phase='consumer-source';
  const sourceCommit=execFileSync('git',['rev-parse',a['qwen-commit']],{cwd:a['qwen-root'],encoding:'utf8'}).trim();
  const source=execFileSync('git',['show',sourceCommit+':models/qwen3_5/kernels.js'],{cwd:a['qwen-root'],encoding:'utf8'});
  const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const affineShader=module.affineShader();
  report={status:'succeeded',phase:null,fixture:f,nativeOutput:[arrays.output[0]],
    provenance:{sourceRoot:root,metaSha256:sha(metaBytes),source:meta.source,selection:'first token, first complete row; all4096columns',sourceArrays:Object.fromEntries(Object.entries(meta.arrays).filter(([k])=>k.startsWith('affine-a.')))},
    consumer:{sourceCommit,path:'models/qwen3_5/kernels.js',sourceSha256:sha(source),affineShader,shaderSha256:sha(affineShader)}};
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await save();console.log(JSON.stringify({status:report.status,phase:report.phase,out:path.resolve(a.out),error:report.error?.message}));}
