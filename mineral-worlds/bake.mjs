// Offline authoring uses the exact interactive domain operations. No timing claim.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createWorld,advance,checkpoint,setConditions,summary} from './state.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v.replace(/^--/,''),all[i+1]]],[]));
if(!args.out)throw Error('--out is required');const out=resolve(args.out);mkdirSync(out,{recursive:true});
const report={schema:'mineral-world-bake.v1',status:'running',phase:'create',sourceSha256:createHash('sha256').update(readFileSync(new URL('./state.mjs',import.meta.url))).digest('hex'),outputs:[]};
const persist=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));persist();
try{
 for(const kind of ['flowstone','salt']){
  report.phase=kind;persist();const s=createWorld({kind,size:Number(args.size??48),depth:6});
  if(kind==='flowstone')setConditions(s,{supply:4,evaporation:.15,mineral:1.5});
  advance(s,Number(kind==='flowstone'?(args.flowSteps??4000):(args.saltSteps??800)));
  const filename=kind+'.mineral.json',data=JSON.stringify({schema:'kaminos.mineral-world.v1',state:checkpoint(s),lightMode:'cool'});
  writeFileSync(join(out,filename),data);report.outputs.push({filename,sha256:createHash('sha256').update(data).digest('hex'),...summary(s)});persist();
 }
 report.status='complete';report.phase='complete';persist();
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};persist();throw error;}
