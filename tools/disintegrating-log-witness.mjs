import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkDisintegrationEvidence} from './disintegration-contracts.mjs';
const [origin,out]=process.argv.slice(2);if(!origin||!out)throw Error('Usage: disintegrating-log-witness.mjs <origin> <out>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:path.resolve(import.meta.dirname,'..'),errors:[],httpFailures:[],inputs:[],frames:[],claim:'Finite coarse consumable log and char residue; no calibrated burn, rigid fracture or room-smoke claim'};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));let browser,rejectError;
const errorSignal=new Promise((_,reject)=>{rejectError=reject;});errorSignal.catch(()=>{});
const guarded=p=>Promise.race([p,errorSignal]);
try{
 await save();report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(0);
 const fail=e=>{report.errors.push(String(e));rejectError(Error(String(e)));};page.on('pageerror',fail);page.on('console',m=>{if(m.type()==='error')fail(m.text());});
 page.on('response',r=>{if(r.status()>=400)report.httpFailures.push({url:r.url(),status:r.status()});});
 report.phase='kernel';await save();await guarded(page.goto(origin+'/tools/moving-volume-fixture.html'));
 report.kernel=await guarded(page.evaluate(async()=>{const {runLogDebrisFixture}=await import('/tools/log-debris-fixture.mjs');return runLogDebrisFixture();}));await save();assert.equal(report.kernel.status,'passed');
 report.url=origin+'/volume-settings-preset.html?preset=vsp-5d3c953814884ed597721350fde28d275a00af04a087d8bb5ec8127984c92bcc#experiment=disintegrating-log&volume_light_field=1&volume_light_field_scene_depth=1&volume_light_field_test_scene=0&volume_collision=kiln';report.phase='startup';await save();
 await guarded(page.goto(report.url));await guarded(page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='disintegrating-log'||window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed')));
 const startup=await page.evaluate(()=>({state:window.kaminosWorkbenchExperiments?.state(),error:window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed')?.textContent}));assert.equal(startup.error,undefined,JSON.stringify(startup));
 const invoke=async(name,input)=>{report.inputs.push({name,input});return guarded(page.evaluate(({name,input})=>window.kaminosWorkbenchExperiments.invoke(name,input),{name,input}));};
 const advance=async target=>{report.inputs.push({advanceTo:target});const r=await guarded(page.evaluate(target=>window.__kaminosVolumePrototype.pauseSelectiveHeadLiveAtSimStep(target),target));assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.effectiveSimStepCount,target);await invoke('pause');};
 report.effective=await page.evaluate(()=>({backend:window.__kaminosVolumePrototype.debugState().backend,grid:window.__kaminosVolumePrototype.debugState().simGrid,gi:window.kaminosSceneGIDebugState(),rays:Number(document.getElementById('volume-steps').value),radius:Number(document.getElementById('volume-immersed-radius').value)}));
 assert.match(report.effective.backend,/WebGPU/);assert.equal(report.effective.grid,32);assert.equal(report.effective.rays,28);assert.equal(report.effective.radius,.1);assert.equal(report.effective.gi.steps,4);assert.equal(report.effective.gi.slices,3);
 report.sources=[];for(const name of ['index.html','volume-core.js','live-log-experiment.mjs','live-log-heat-core.mjs','live-log-heat-gpu.mjs','live-log-surface-mask.mjs','burn-table-material.mjs','scene-solid-gpu.mjs','log-consumption.mjs','log-debris-gpu.mjs','experiments/sinter/live-log-heat.experiment.mjs','experiments/sinter/disintegrating-log.experiment.mjs']){
  const served=await(await page.request.get(origin+'/'+name)).body(),local=await fs.readFile(path.join(report.repoRoot,name));const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(served),sha(local),name);report.sources.push({name,sha256:sha(served)});
 }
 let lastSnapshot;
 async function sample(name){
  const state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read()),snapshots=await invoke('snapshot');assert.equal(snapshots.length,1);
  const collision=await page.evaluate(async()=>{const r=await window.__kaminosVolumePrototype.sampleSceneCollisionMask();return {...r,cells:r.cells?Array.from(r.cells):null};});
  await fs.writeFile(path.join(out,name+'-raw.json'),JSON.stringify({state,snapshots,collision}));
  const snapshot=snapshots[0];lastSnapshot=snapshot;let attached=0,detached=0,gas=0,attachedFuel=0,residue=0;const ids=[];
  for(let i=0;i<snapshot.initial.length;i++)if(snapshot.initial[i]){
   const fuel=snapshot.material[i*8+5],active=snapshot.particles[i*16+11];assert.ok(Number.isFinite(fuel));
   if(active>.5){detached++;residue+=snapshot.particles[i*16+13];ids.push(snapshot.particles[i*16+12]);assert.equal(snapshot.particles[i*16+12],i);assert.ok(fuel<=.150002);}else{attached++;attachedFuel+=fuel;}
   gas+=1-fuel;
  }
  assert.ok(Math.abs(gas+attachedFuel+residue-snapshot.initial.reduce((a,b)=>a+b,0))<.002,'Gas/attached/residue accounting');
  assert.ok(snapshot.particles.every(Number.isFinite)&&snapshot.material.every(Number.isFinite));assert.equal(new Set(ids).size,ids.length);
  await page.evaluate(()=>window.__kaminosVolumePrototype.setSelectiveHeadLiveCapturePaused(false));await invoke('frame');
  const frame=await page.evaluate(()=>window.kaminosSceneGIDebugState().sceneFrames);await page.waitForFunction(frame=>window.kaminosSceneGIDebugState().sceneFrames>frame,frame);
  await page.screenshot({path:path.join(out,name+'.png')});
  const row={name,attached,detached,gas,attachedFuel,residue,solidCells:collision.cells?.reduce((a,b)=>a+b,0),state};report.frames.push(row);await save();return row;
 }
 const cold=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());assert.equal(cold.paused,true);assert.equal(cold.burner,false);
 const initial=await sample('cold');assert.equal(initial.detached,0);
 await invoke('run');report.phase='ignition';await save();await advance(600);await sample('hot');
 await invoke('burnerOff');await invoke('pause');await advance(900);await sample('burner-off');
 report.phase='consumption';await save();await invoke('move',{position:[.7,0,0]});await invoke('pause');await advance(1500);await sample('shedding');
 report.phase='paused-edit';await save();await invoke('view',{mode:'char'});const pausedBefore=await sample('paused-before'),priorParticles=structuredClone(lastSnapshot.particles);
 report.inputs.push({ordinaryEditorTransform:{position:[.7,.15,.1],rotation:[.2,1.1,0]}});
 const frameBefore=await page.evaluate(()=>window.kaminosSceneGIDebugState().sceneFrames);
 await page.evaluate(async()=>{const state=await window.kaminosWorkbenchExperiments.read();if(typeof state.objectId!=='string')throw Error('Experiment has no authored object id');window.kaminosSetSceneObjectTransform(state.objectId,{position:[.7,.15,.1],rotation:[.2,1.1,0]});});
 await page.waitForFunction(frame=>window.kaminosSceneGIDebugState().sceneFrames>frame,frameBefore);
 const pausedAfter=await sample('paused-after');assert.equal(pausedAfter.state.fields[0].steps,pausedBefore.state.fields[0].steps);assert.deepEqual(lastSnapshot.particles,priorParticles,'Paused edit cannot move independent GPU residue');
 const pose=pausedAfter.state.debris[0];assert.ok(pose.attachedWorld.every((v,i)=>Math.abs(v-pose.sourceWorld[i])<1e-5),'Paused attached caps must follow ordinary editor transform');report.pausedEdit={status:'passed',materialSteps:pausedAfter.state.fields[0].steps,particlesUnchanged:true,sourceWorld:pose.sourceWorld,attachedWorld:pose.attachedWorld};
 await invoke('view',{mode:'beauty'});
 await invoke('pause');await advance(2400);const consumed=await sample('consumed');assert.ok(consumed.detached>0,'Burning must release finite residue');assert.ok(consumed.attached<initial.attached);assert.ok(consumed.solidCells<initial.solidCells,'Consumed geometry must lose obstruction');
 await invoke('view',{mode:'char'});await sample('consumed-char');await invoke('view',{mode:'beauty'});
 await invoke('reset');const reset=await sample('reset');assert.equal(reset.detached,0);assert.equal(reset.attached,initial.attached);assert.equal(reset.gas,0);
 await page.setViewportSize({width:390,height:844});await invoke('frame');await page.screenshot({path:path.join(out,'mobile.png')});
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());checkDisintegrationEvidence(report);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();await save();}
