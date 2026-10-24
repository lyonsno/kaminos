import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {adaptSurfaceSplats} from '../adaptive-surface-splats.mjs';
const [source,output,target,...extra]=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/prepare-adaptive-splats.mjs SOURCE_DIR OUTPUT_DIR TARGET_COUNT');
// Refuse before creating any output or entering the failure-report writer.
if(path.resolve(source)===path.resolve(output)||(fs.existsSync(source)&&fs.existsSync(output)&&fs.realpathSync(source)===fs.realpathSync(output)))throw Error('Output must not overwrite source');
fs.mkdirSync(output,{recursive:true});
const report={ok:false,phase:'arguments',source:path.resolve(source),requestedTargetCount:target};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
try{
 if(extra.length||!Number.isSafeInteger(Number(target))||Number(target)<1)throw Error('Positive integer target count required');
 report.phase='load';const meta=JSON.parse(fs.readFileSync(path.join(source,'report.json')));
 if(!meta.ok||!meta.triangles)throw Error('A successful source with original triangle connectivity is required');
 const read=(file,sha,Type)=>{const b=fs.readFileSync(path.join(source,file));if(hash(b)!==sha)throw Error(`Source hash mismatch: ${file}`);return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));};
 const data=read('surfels.f32',meta.dataSHA256,Float32Array),triangles=read(meta.triangles.file,meta.triangles.sha256,Uint32Array);
 if(triangles.length!==meta.triangles.count*3)throw Error('Triangle count mismatch');
 report.sourceDataSHA256=meta.dataSHA256;report.sourceTrianglesSHA256=meta.triangles.sha256;
 report.repoRoot=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
 report.phase='convert';const result=adaptSurfaceSplats(data,meta,triangles,{targetCount:Number(target)});
 report.phase='write';Object.assign(report,result.meta);
 for(const [field,file]of [['data','surfels.f32'],['parent','parent.u32'],['footprints','footprints.f32'],['factors','factors.u8'],['depthTolerance','depth-tolerance.f32']]){
  const array=result[field],bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength);fs.writeFileSync(path.join(output,file),bytes);
  if(field==='data')report.dataSHA256=hash(bytes);
  else report[field]={file,sha256:hash(bytes),...(field==='footprints'?{stride:8,supportSigma:3,layout:'tangent-u.xyz,sigma-u,tangent-v.xyz,sigma-v'}:{})};
 }
 report.ok=true;report.phase='done';
}catch(error){report.ok=false;report.error=String(error);process.exitCode=1;}
finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
