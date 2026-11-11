import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [configPath,out,expectedSha]=process.argv.slice(2),repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!configPath||!out){console.error('usage: node tools/granular-overlap-study.mjs CONFIG OUTPUT_DIRECTORY [EXPECTED_SHA]');process.exit(2);}
await fs.mkdir(out,{recursive:true});
const report={schema:'kaminos.granular-overlap-study.v1',status:'running',phase:'source-preflight',repoRoot,requestedSource:expectedSha??null,jobId:process.env.GREENROOM_JOB_ID??null,timingScope:'case includes local world construction, stepping, state handoff writes and final metrics',nodeVersion:process.version,effectiveRoute:'cannon-es-0.20.0-cpu/convex-grains/frozen-neighbor-patches',cases:[],claim:'decomposition experiment; fine-earth appearance and scaling unestablished',clockSemantics:'parent preparation clock held during subsequent numerical relaxation; no physical ageing implied'};
const save=()=>fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(report,null,2));
const write=async(name,value)=>{const bytes=JSON.stringify(value);await fs.mkdir(path.dirname(path.join(out,name)),{recursive:true});await fs.writeFile(path.join(out,name),bytes);return {path:name,sha256:createHash('sha256').update(bytes).digest('hex')};};
await save();let model;
try{
 report.source={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:repoRoot,encoding:'utf8'}).trim()};if(expectedSha&&report.source.commit!==expectedSha)throw Error('Requested source does not match executing source');if(report.source.dirty)throw Error('Study source tree is dirty');await save();
 report.phase='configuration';await save();report.configurationInput=JSON.parse(await fs.readFile(configPath,'utf8'));report.configurationFile=await write('configuration.json',report.configurationInput);
 const {makeStudyState,overlapCases,runOverlapCase,packingMetrics}=await import(pathToFileURL(path.join(repoRoot,'granular-overlap.mjs'))),{createGranularPreparation,preparationSource}=await import(pathToFileURL(path.join(repoRoot,'granular-preparation.mjs')));
 const specimen=makeStudyState(report.configurationInput);report.configuration=specimen.configuration;report.plan=overlapCases(specimen.configuration);report.fineIds=specimen.fineIds;report.anchorIds=specimen.anchorIds;report.nominalDiameter=specimen.nominalDiameter;report.initialUnsettled=await write('initial-unsettled.json',specimen.state);
 report.phase='shared-initial-settle';await save();const began=performance.now();model=createGranularPreparation(null,specimen.state,{activeIds:specimen.fineIds});model.start('settle',{seconds:specimen.configuration.settleSeconds});while(model.read().phase)model.advance(.025);const initial=model.snapshot();model.dispose();model=null;
 report.initialSettleMs=performance.now()-began;report.initial=await write('initial.json',initial);report.geometrySha256=createHash('sha256').update(JSON.stringify(initial.ingredients)).digest('hex');report.initialMetrics=packingMetrics(initial,specimen.anchorIds);await save();
 for(const caseDefinition of report.plan){
  report.phase='case';report.currentCase=caseDefinition.id;await save();const entry={...caseDefinition,status:'running',steps:0,trajectory:`${caseDefinition.id}/steps.ndjson`};report.cases.push(entry);await fs.mkdir(path.join(out,caseDefinition.id),{recursive:true});await save();const t=performance.now();
  const result=await runOverlapCase(initial,{...specimen,caseDefinition,onStep:async(step,state)=>{await fs.appendFile(path.join(out,entry.trajectory),JSON.stringify({...step,parentClock:state.time,lidHeight:state.lidHeight,grains:state.grains,geometrySha256:report.geometrySha256})+'\n');entry.steps++;}});
  entry.executionMs=performance.now()-t;entry.snapshot=await write(`${caseDefinition.id}/snapshot.json`,result.state);entry.source=await write(`${caseDefinition.id}/source.json`,preparationSource(result.state));entry.metrics=result.metrics;entry.activeParticleSteps=result.activeParticleSteps;entry.visits=result.visits;entry.requestedStrain=result.requestedStrain;entry.effectiveStrain=result.effectiveStrain;entry.status='completed';await save();
 }
 report.status='completed';report.phase='complete';delete report.currentCase;
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}finally{model?.dispose();await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,out,error:report.error}));
