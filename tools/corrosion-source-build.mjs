// kaminos-test: manual — Greenroom CPU formation with retained state snapshots.
import fs from 'node:fs/promises';import path from 'node:path';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
import{createCorrosionState,advanceCorrosion,serializeCorrosion,corrosionSummary}from'../coating-corrosion.mjs';
import{createCorrosionSource}from'../corrosion-source.mjs';
const [configPath,out]=process.argv.slice(2);if(!configPath||!out)throw Error('Usage: node tools/corrosion-source-build.mjs CONFIG OUTPUT');
await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.corrosion-source-build.v1',status:'running',phase:'admission',repoRoot:process.cwd(),configPath,job:process.env.GREENROOM_JOB_ID??null,snapshots:[],claim:'Reduced nondimensional formation source, not validated corrosion kinetics, full film fracture or a learned material'};
const publish=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await publish();
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 if(!report.job)throw Error('Corrosion formation requires Greenroom admission');
 report.phase='configuration';const config=JSON.parse(await fs.readFile(configPath,'utf8'));report.config=config;
 if(!Array.isArray(config.times)||!config.times.length||!config.times.every((v,i)=>Number.isFinite(v)&&v>=0&&(!i||v>config.times[i-1])))throw Error('Retained times must be strictly increasing and nonnegative');
 report.phase='source-preflight';report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceStatus=execFileSync('git',['status','--porcelain'],{encoding:'utf8'});
 if(config.sourceRevision!==report.sourceRevision||report.sourceStatus)throw Error('Requested clean source revision is not effective');
 report.sourceFiles={};for(const name of ['coating-corrosion.mjs','corrosion-source.mjs','tools/corrosion-source-build.mjs']){const b=await fs.readFile(name);report.sourceFiles[name]=sha(b);await fs.writeFile(path.join(out,path.basename(name)),b);}
 await fs.writeFile(path.join(out,'config.json'),JSON.stringify(config,null,2));
 const state=createCorrosionState(config.model),catalog={schema:'kaminos.corrosion-evolution.v1',status:'passed',sourceRevision:report.sourceRevision,sourceFiles:report.sourceFiles,snapshots:[]};
 if(!state.opening.some(Boolean))throw Error('The authored defect is unresolved at this formation resolution');
 report.phase='formation';await publish();
 for(const [index,time]of config.times.entries()){
  advanceCorrosion(state,time-state.time);const value=serializeCorrosion(state),summary=corrosionSummary(state),file=`state-${index}.model`,bytes=Buffer.from(JSON.stringify(value));
  if(Math.abs(summary.ironBalanceError)>1e-8*Math.max(1,summary.consumedIron))throw Error('Iron balance failed');
  const source=createCorrosionSource(value),sourceFile=`source-${index}.json`;await fs.writeFile(path.join(out,file),bytes);await fs.writeFile(path.join(out,sourceFile),JSON.stringify(source));
  const entry={index,time,file,sha256:sha(bytes),bytes:bytes.length,sourceFile,triangles:source.triangles.length,summary};report.snapshots.push(entry);catalog.snapshots.push(entry);await publish();console.log(JSON.stringify({phase:'snapshot',index,time,...summary}));
 }
 report.phase='source-postflight';if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==report.sourceRevision||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}))throw Error('Source changed during formation');
 await fs.writeFile(path.join(out,'catalog.json'),JSON.stringify(catalog,null,2));report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{await publish();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error}));}
