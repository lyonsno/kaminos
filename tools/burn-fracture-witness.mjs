import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {checkBurnFractureObservation} from './burn-fracture-contract.mjs';
const [origin,out,assetPath,coldPath,hotPath]=process.argv.slice(2);
if(!origin||!out)throw Error('Usage: burn-fracture-witness.mjs <origin> <out> <asset> <cold material> <burned material>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:path.resolve(import.meta.dirname,'..'),errors:[],observations:[]},save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');
let context;
try{
 await save();if(!hotPath)throw Error('Complete source, cold and burned material inputs required');report.revision=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{executablePath:report.executable,headless:true,viewport:{width:1280,height:900},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=context.pages()[0];page.setDefaultTimeout(0);let reject;const failure=new Promise((_,fail)=>{reject=fail;});failure.catch(()=>{});const guard=p=>Promise.race([p,failure]);
 const fail=e=>{report.errors.push(String(e));reject(Error(String(e)));};page.on('pageerror',fail);page.on('console',m=>{if(m.type()==='error')fail(m.text());});
 const asset=await fs.readFile(assetPath),sourceSha256=hash(asset),upload=await page.request.post(origin+'/api/ingest-mesh',{data:asset,headers:{'Content-Type':'model/gltf-binary'}});assert.ok(upload.ok());const receipt=await upload.json();assert.equal(receipt.sha256,sourceSha256);
 report.source={path:assetPath,sha256:sourceSha256,url:receipt.source};report.sources=[];
 for(const name of ['burn-fracture-core.mjs','burn-fracture-gpu.mjs','burn-fracture-replay.mjs','burn-structure-core.mjs','burn-structure-gpu.mjs','scene-burn-structure.mjs','burn-structure.worker.mjs','fracture-whole-prepare.mjs','fracture-material-sections.mjs','fracture-coarse-rest-frame.mjs','fracture-coarse-kernels.mjs','lib/fracture/rigid-engine.js','log-consumption.mjs','experiments/sinter/burn-fracture-replay.experiment.mjs']){const local=await fs.readFile(path.join(report.repoRoot,name)),response=await page.request.get(origin+'/'+name);assert.ok(response.ok());assert.equal(hash(await response.body()),hash(local));report.sources.push({name,sha256:hash(local)});}
 const invoke=(op,value)=>guard(page.evaluate(({op,value})=>window.kaminosWorkbenchExperiments.invoke(op,value),{op,value}));
 for(const [name,file]of [['cold',coldPath],['burned',hotPath]]){
  report.phase='load:'+name;await save();const bytes=await fs.readFile(file),sha256=hash(bytes),relative='scratch/burn-fracture-'+sha256+'.json';await fs.copyFile(file,path.join(report.repoRoot,relative));
  const inputs={source:receipt.source,sourceSha256,material:'/'+relative,materialSha256:sha256},url=origin+'/?workspace=workbench&experiment=sinter-burn-fracture-replay&experiment_inputs='+encodeURIComponent(JSON.stringify(inputs));
  await guard(page.goto(origin+'/?workspace=workbench'));await guard(page.waitForFunction(()=>window.kaminosWorkbenchExperiments));await guard(page.evaluate(inputs=>window.kaminosWorkbenchExperiments.open('sinter-burn-fracture-replay',inputs),inputs));
  assert.equal(new URL(page.url()).searchParams.get('experiment'),'sinter-burn-fracture-replay');report.effectiveUrl=page.url();
  const read=await guard(page.evaluate(()=>window.kaminosWorkbenchExperiments.read())),before=await invoke('snapshot');checkBurnFractureObservation(read,before);
  const observation={name,input:{path:file,sha256,url},read,before};report.observations.push(observation);await save();await page.screenshot({path:path.join(out,name+'-before.png')});
  report.phase='advance:'+name;await save();await invoke('advance',.5);observation.after=await invoke('snapshot');observation.verdict=checkBurnFractureObservation(await page.evaluate(()=>window.kaminosWorkbenchExperiments.read()),observation.after);await save();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(out,name+'-after.png')});
  const moves=before.positions.filter((_,i)=>i%4<3).map((v,i)=>Math.abs(v-observation.after.positions[Math.floor(i/3)*4+i%3]));observation.maximumMovement=Math.max(...moves);
  const rotations=before.quaternions.map((v,i)=>Math.abs(v-observation.after.quaternions[i]));observation.maximumRotationDelta=Math.max(...rotations);
  if(name==='cold'){assert.equal(observation.verdict.broken,0,'Unloaded original material must not fracture');assert.ok(observation.maximumMovement<.01,'Original clamped object must remain stable');}
  else {assert.ok(observation.verdict.broken>0,'Observed material loss must remove connections');assert.ok(observation.maximumMovement>.01,'Regions must actually move after support loss');}
  report.phase='playback:'+name;await save();
  await page.getByRole('button',{name:'Run',exact:true}).click();
  observation.playbackStarted=await guard(page.evaluate(()=>window.kaminosWorkbenchExperiments.read()));await save();
  await guard(page.evaluate(async start=>{for(;;){const s=await window.kaminosWorkbenchExperiments.read();if(s.error)throw Error(s.error);if(s.mechanics.seconds>start+.05)return;await new Promise(requestAnimationFrame);}},observation.after.state.seconds));
  report.phase='pause:'+name;await save();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  observation.playback=await guard(page.evaluate(()=>window.kaminosWorkbenchExperiments.read()));assert.equal(observation.playback.running,false);assert.ok(observation.playback.mechanics.seconds>observation.after.state.seconds);
  observation.playbackSnapshot=await invoke('snapshot');checkBurnFractureObservation(observation.playback,observation.playbackSnapshot);
  await save();await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
 }
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await context?.close();await save();}
