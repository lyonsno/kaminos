import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {embedSurfaceSplats} from '../surface-splat-glb.mjs';

const [proxy,fieldDir,output]=process.argv.slice(2);if(!proxy||!fieldDir||!output)throw Error('Usage: node tools/package-surface-splats.mjs PROXY.glb FIELD_DIR OUTPUT.glb');
const report={ok:false,phase:'read',proxy:path.resolve(proxy),fieldDir:path.resolve(fieldDir),output:path.resolve(output),repoRoot:path.resolve(import.meta.dirname,'..'),sources:[]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(path.dirname(output),{recursive:true});
try{
 report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 report.dirty=!!execFileSync('git',['status','--porcelain'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 for(const file of ['tools/package-surface-splats.mjs','surface-splat-glb.mjs','surface-splat-object.mjs','deferred-surface-splats.mjs'])report.sources.push({path:path.join(report.repoRoot,file),sha256:sha(await fs.readFile(path.join(report.repoRoot,file)))});
 const metaBytes=await fs.readFile(path.join(fieldDir,'report.json')),meta=JSON.parse(metaBytes);if(!meta.ok)throw Error('Source field report is not successful');
 report.sources.push({path:path.join(fieldDir,'report.json'),sha256:sha(metaBytes)});
 async function read(name,hash){
  if(path.basename(name)!==name)throw Error('Field file must be inside its source directory');
  const file=path.join(fieldDir,name),bytes=await fs.readFile(file),digest=sha(bytes);if(!hash||digest!==hash)throw Error(`Field identity mismatch: ${file}`);
  report.sources.push({path:file,sha256:digest});return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 }
 const data=await read('surfels.f32',meta.dataSHA256),footprints=await read(meta.footprints.file,meta.footprints.sha256),depthTolerance=meta.depthTolerance?await read(meta.depthTolerance.file,meta.depthTolerance.sha256):undefined;
 const source=await fs.readFile(proxy);report.sources.push({path:path.resolve(proxy),sha256:sha(source)});report.phase='encode';
 const result=embedSurfaceSplats(source,{data,meta,footprints,depthTolerance});await fs.writeFile(output,new Uint8Array(result));
 Object.assign(report,{ok:true,phase:'complete',count:meta.count,bytes:result.byteLength,sha256:sha(new Uint8Array(result))});
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await fs.writeFile(output+'.report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
