import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {validateGenerationInputs} from './generation-inputs.js';
import {packGenerationTensor,expandGenerationTensor,generationTensorStorage} from './generation-storage.js';

const {values:a}=parseArgs({options:{manifest:{type:'string'},out:{type:'string'},'repo-root':{type:'string'},'expected-commit':{type:'string'}}});
if(!a.manifest||!a.out||!a['repo-root']||!a['expected-commit'])throw Error('--manifest --out --repo-root --expected-commit required');
const out=path.resolve(a.out),source=path.resolve(a.manifest),root=path.resolve(a['repo-root']);
if(out===path.dirname(source))throw Error('compact package must use a separate output directory');
await fs.mkdir(out,{recursive:true});
const hash=raw=>createHash('sha256').update(raw instanceof ArrayBuffer?new Uint8Array(raw):raw).digest('hex');
const report={schema:'trellis2.compact-package.v0',status:'running',phase:'source-admission',modelCalls:0,sourceManifest:source,
  command:process.argv,output:out,tensors:[],originalBytes:0,storedBytes:0};
const persist=()=>fs.writeFile(path.join(out,'compact-report.json'),JSON.stringify(report,null,2)+'\n');
await persist();
try{
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();
  if(commit!==a['expected-commit']||dirty)throw Error('exact clean compact-package producer required');
  if(path.resolve(new URL(import.meta.url).pathname)!==path.join(root,'models/trellis2/pack-compact-generation.mjs'))throw Error('effective packager source differs');
  report.producer={root,commit,dirty};
  const sourceBytes=await fs.readFile(source),m=JSON.parse(sourceBytes),plan=validateGenerationInputs(m);
  report.sourceManifestSha256=hash(sourceBytes);
  // A rerun may reuse only a fully identified prior package from this source.
  const priorPath=path.join(out,'manifest.json');
  let prior;try{prior=JSON.parse(await fs.readFile(priorPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior&&prior.compactSource?.sha256!==report.sourceManifestSha256)throw Error('output belongs to a different source package');
  report.phase='pack-and-verify';await persist();
  for(const key of plan.tensorKeys){
    const row=m.tensors[key],storage=generationTensorStorage(row),sourcePath=path.join(path.dirname(source),storage.file);
    const disk=await fs.readFile(sourcePath);
    if(disk.byteLength!==storage.byteLength||hash(disk)!==storage.sha256)throw Error('changed source tensor '+key);
    const original=expandGenerationTensor(disk.buffer.slice(disk.byteOffset,disk.byteOffset+disk.byteLength),storage.encoding);
    if(original.byteLength!==row.byteLength||hash(original)!==row.sha256)throw Error('changed reconstructed source '+key);
    const packed=packGenerationTensor(original),encoding=packed?.encoding??'f32-le',bytes=packed?.bytes??original,digest=hash(bytes);
    if(hash(expandGenerationTensor(bytes,encoding))!==row.sha256)throw Error('non-lossless packing '+key);
    const file=encoding==='f32-le'?row.file:`${digest}.${encoding}`,target=path.join(out,file);
    try{const existing=await fs.readFile(target);if(existing.byteLength!==bytes.byteLength||hash(existing)!==digest)throw Error('existing tensor identity collision '+file);}
    catch(e){if(e.code!=='ENOENT')throw e;
      if(encoding==='f32-le'&&storage.encoding==='f32-le'){
        try{await fs.link(sourcePath,target);}catch(linkError){if(linkError.code!=='EXDEV')throw linkError;await fs.copyFile(sourcePath,target,1);}
      }else await fs.writeFile(target,new Uint8Array(bytes),{flag:'wx'});
    }
    if(packed)row.storage={encoding,file,byteLength:bytes.byteLength,sha256:digest};else delete row.storage;
    report.originalBytes+=row.byteLength;report.storedBytes+=bytes.byteLength;
    report.tensors.push({key,encoding,originalBytes:row.byteLength,storedBytes:bytes.byteLength,decodedSha256:row.sha256,storedSha256:digest});
    await persist();
  }
  m.compactSource={path:source,sha256:report.sourceManifestSha256,producer:report.producer};
  validateGenerationInputs(m);
  const manifest=JSON.stringify(m,null,2)+'\n';
  await fs.writeFile(path.join(out,'manifest.pending.json'),manifest);
  await fs.rename(path.join(out,'manifest.pending.json'),priorPath);
  report.status='succeeded';report.phase=null;report.manifestSha256=hash(manifest);
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await persist();}
console.log(JSON.stringify({status:report.status,originalBytes:report.originalBytes,storedBytes:report.storedBytes,manifestSha256:report.manifestSha256,error:report.error}));
