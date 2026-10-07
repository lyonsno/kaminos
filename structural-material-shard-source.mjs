import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [input,output,sizeInput='[2.4,0.6,0.6]']=process.argv.slice(2);
if(!input||!output)throw new Error('usage: node structural-material-shard-source.mjs SOURCE.glb OUTPUT.json [SIZE_JSON]');
const report={status:'running',phase:'input',input,output,requestedSize:sizeInput};
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});save();
try{
  report.size=JSON.parse(sizeInput);report.phase='source-admission';save();
  const bytes=fs.readFileSync(input),{prepareStoneFromGlb}=await import('./structural-material-stone-prepare.mjs');
  const prepared=prepareStoneFromGlb(bytes,{size:report.size,cellSize:Math.max(...report.size)*2});
  if(prepared.cells.length!==1||prepared.cells[0].geometry.exterior.some(v=>!v))throw new Error('Whole-solid preparation unexpectedly created an internal partition');
  const g=prepared.cells[0].geometry;
  report.sourceSha256=createHash('sha256').update(bytes).digest('hex');report.volume=prepared.volume;
  report.vertices=Array.from({length:g.properties.length/g.numProp},(_,i)=>g.properties.slice(i*g.numProp,i*g.numProp+3));
  report.triangles=Array.from({length:g.indices.length/3},(_,i)=>g.indices.slice(i*3,i*3+3));
  report.route='imported-whole-solid-manifold-3.5.4';report.status='passed';report.phase='complete';save();
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};save();throw error;}
