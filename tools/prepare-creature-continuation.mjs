// Caller-owned derived export; raw generation and original motion stay untouched.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareGivenContinuation} from '../experiments/creature-motion/given-motion-source.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v,all[i+1]]],[]));
const out=args['--out'];if(!out)throw Error('Caller output directory required');
await fs.mkdir(out,{recursive:true});await assertFresh(out+'/report.json');await assertFresh(out+'/motion.json');
const report={status:'failed',phase:'inputs',requested:args};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function assertFresh(file){try{await fs.access(file);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('Preserve existing output: '+file);}
try{
 const load=async name=>{if(!args[name])throw Error('Required input '+name);const bytes=await fs.readFile(args[name]);return {value:JSON.parse(bytes),sha256:hash(bytes)};};
 const raw=await load('--raw'),run=await load('--generation-report'),prefix=await load('--prefix');
 report.inputs={raw:raw.sha256,generationReport:run.sha256,prefix:prefix.sha256};report.phase='source-admission';
 const motion=prepareGivenContinuation({raw:raw.value,run:run.value,prefix:prefix.value,prefixSha256:prefix.sha256});
 motion.provenance={rawMotionSha256:raw.sha256,generationReportSha256:run.sha256,prefixMotionSha256:prefix.sha256};
 const bytes=JSON.stringify(motion);await fs.writeFile(out+'/motion.json',bytes,{flag:'wx'});
 report.status='exported';report.phase='complete';report.effective={motionSha256:hash(bytes),frames:motion.frames,joints:motion.joints,sampling:motion.sampling,controllerNorm:motion.controllerNorm,continuation:motion.continuation,generationSource:motion.generationSource};
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));}
