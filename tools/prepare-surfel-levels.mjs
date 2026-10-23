import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {reduceSurfelRows} from '../surfel-field-reduction.mjs';
const [source,output,...requested]=process.argv.slice(2);
if(!source||!output||!requested.length)throw Error('Usage: node tools/prepare-surfel-levels.mjs SOURCE_DIR OUTPUT_DIR FACTOR...');
fs.mkdirSync(output,{recursive:true});
const report={ok:false,phase:'load',source:path.resolve(source),levels:[]};
try{
 const meta=JSON.parse(fs.readFileSync(path.join(source,'report.json'))),bytes=fs.readFileSync(path.join(source,'surfels.f32'));
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 report.sourceSHA256=hash(bytes);if(!meta.ok||report.sourceSHA256!==meta.dataSHA256)throw Error('Source identity mismatch');
 const data=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
 for(const value of requested){
  const factor=Number(value);report.phase=`reduce-${factor}`;
  const result=reduceSurfelRows(data,meta,factor),dir=path.join(output,`factor-${factor}`);fs.mkdirSync(dir,{recursive:true});
  const reduced=Buffer.from(result.data.buffer),parents=Buffer.from(result.parent.buffer);
  fs.writeFileSync(path.join(dir,'surfels.f32'),reduced);fs.writeFileSync(path.join(dir,'parent.u32'),parents);
  const metadata={...result.meta,ok:true,phase:'done',dataSHA256:hash(reduced),parentSHA256:hash(parents),sourceDataSHA256:report.sourceSHA256};
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(metadata,null,2));
  report.levels.push({factor,count:metadata.count,sourceCount:meta.count,dataSHA256:metadata.dataSHA256,path:dir});
 }
 report.phase='done';report.ok=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
