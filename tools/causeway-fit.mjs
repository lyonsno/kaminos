// Greenroom entry: native conformance, then the existing source/fit consumer.
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
const [configPath,out]=process.argv.slice(2);if(!configPath||!out)throw Error('Usage: node tools/causeway-fit.mjs CONFIG OUTPUT');
await fs.mkdir(out,{recursive:true});const report={status:'running',phase:'admission',job:process.env.GREENROOM_JOB_ID??null,configPath,repoRoot:process.cwd()};
const save=()=>fs.writeFile(path.join(out,'continuation.json'),JSON.stringify(report,null,2));
const run=async(args,log)=>{const file=await fs.open(path.join(out,log),'w');try{await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{stdio:['ignore',file.fd,file.fd]});p.on('error',reject);p.on('exit',(code,signal)=>code===0?resolve():reject(Error(`${args[0]} exited ${code}, signal ${signal}`)));});}finally{await file.close();}};
try{
 await save();if(!report.job)throw Error('Greenroom admission required');
 report.phase='native-spatial-conformance';await save();await run(['tools/neumip-spatial-training-check.mjs',path.join(out,'spatial-conformance')],'spatial-conformance.log');
 const conformance=JSON.parse(await fs.readFile(path.join(out,'spatial-conformance/report.json')));if(conformance.status!=='passed'||conformance.evidence?.route!=='hardware')throw Error('Native hardware spatial conformance failed');report.spatialConformance=conformance;
 report.phase='periodic-transport-conformance';await save();await run(['--test','tests/surface-teacher-periodic-native.mjs'],'periodic-transport.log');
 report.phase='fit';await save();await run(['tools/ground-material-fit.mjs',configPath,out],'fit.log');
 const fit=JSON.parse(await fs.readFile(path.join(out,'report.json')));if(fit.status!=='passed'||fit.phase!=='complete'||fit.evidence?.route!=='hardware')throw Error('Fit did not complete on hardware');
 // Byte-identical query archives across this seed-matched relief bank share an
 // inode. Every path and every byte remains available; labels stay independent.
 const config=JSON.parse(await fs.readFile(configPath)),master=config.sharedQueryArchive,current=path.join(out,'fresh-training-queries.f32');
 if(master){report.phase='query-archive-sharing';await save();await fs.mkdir(path.dirname(master),{recursive:true});
  try{await fs.link(current,master);report.queryArchive={path:master,sha256:fit.dataset.fresh.queries.sha256,created:true};}
  catch(e){if(e.code!=='EEXIST')throw e;const bytes=await fs.readFile(master),sha=createHash('sha256').update(bytes).digest('hex');if(sha!==fit.dataset.fresh.queries.sha256)throw Error('Shared query archive differs; all original evidence retained');const link=current+'.shared';await fs.link(master,link);await fs.rename(link,current);report.queryArchive={path:master,sha256:sha,created:false,byteIdentityVerified:true};}
 }
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}
finally{await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error}));}
