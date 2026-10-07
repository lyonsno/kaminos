import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { prepareSolidTopology,packSolidTopology } from './structural-material-solid-topology.mjs';

const [input,out,configInput]=process.argv.slice(2);
if(!input||!out)throw new Error('usage: node structural-material-solid-prepare.mjs MESH.json OUTPUT_DIRECTORY CONFIG.json');
fs.mkdirSync(out,{recursive:true});const output=path.join(out,'report.json'),report={status:'running',phase:'input',input:path.resolve(input),out:path.resolve(out),argv:process.argv},save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');save();
try{
 const source=fs.readFileSync(input),mesh=JSON.parse(source),config=JSON.parse(fs.readFileSync(configInput));report.inputSha256=hash(source);report.sourceSha256=mesh.sourceSha256;report.config=config;report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.models=[];report.phase='topology';save();
 for(const kind of ['graph','pmb']){
  const start=performance.now(),model=prepareSolidTopology(mesh,{...config,kind}),n=model.positions.length;
  const arrays=packSolidTopology(model),buffers={};
  for(const [name,array] of Object.entries(arrays)){const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),filename=`${kind}-${name}.bin`;fs.writeFileSync(path.join(out,filename),bytes);buffers[name]={filename,byteLength:bytes.byteLength,sha256:hash(bytes),type:array.constructor.name};}
  report.models.push({kind,route:model.route,material:model.material,points:n,elements:model.elements.length,bonds:model.bonds.length,incidences:model.incidence.length,colorCount:model.colorCount,volume:model.volume,mass:model.masses.reduce((a,b)=>a+b,0),preparationMilliseconds:performance.now()-start,buffers,claim:model.claim});save();
 }
 report.status='passed';report.phase='complete';save();
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};save();process.exitCode=1;}
console.log(JSON.stringify({status:report.status,phase:report.phase,output,failure:report.failure?.message}));
