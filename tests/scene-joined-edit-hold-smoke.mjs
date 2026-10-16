// kaminos-test: manual — short actual Workbench gesture, not a throughput benchmark
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {launchChrome,sourceIdentity} from '../models/flux2-klein/cdp-harness.mjs';
import {assertResidentMotion} from '../tools/joined-resident-witness.mjs';
const [url,out,mode='held',storeSource]=process.argv.slice(2);assert(out,'evidence directory required');
assert(['held','resident'].includes(mode),'unknown motion route');
await fs.mkdir(out,{recursive:true});
const report={source:sourceIdentity(resolve('.')),url,mode,phase:'start',claim:'edit motion/commit/cancel consumer conformance; not scene frame-budget closure'};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
let browser,server,serverExit,serverError;
try{
 await save();await fs.copyFile(new URL(import.meta.url),out+'/effective-smoke.mjs');
 if(storeSource){
  report.phase='server';report.storeSource=resolve(storeSource);report.stores=resolve(out,'runtime');await save();
  await fs.cp(report.storeSource,report.stores,{recursive:true,errorOnExist:true,force:false});
  server=spawn('python3',['serve.py',new URL(url).port,'--volume-settings-store',report.stores+'/settings',
   '--volume-basin-session-store',report.stores+'/basins','--volume-cockpit-layout-store',report.stores+'/layouts'],
   {cwd:resolve('.'),env:{...process.env,KAMINOS_SCENES_DIR:report.stores+'/scenes'},stdio:['ignore','pipe','pipe']});
  report.server={pid:server.pid,port:new URL(url).port,root:resolve('.')};report.serverLog='';
  server.stdout.on('data',b=>{report.serverLog+=b;});server.stderr.on('data',b=>{report.serverLog+=b;});
  serverExit=new Promise(r=>{server.once('error',e=>{serverError=e;r();});server.once('exit',r);});
  while(true){
   if(serverError)throw serverError;if(server.exitCode!==null)throw Error('witness server exited: '+report.serverLog);
   try{const r=await fetch(new URL('/api/runtime-config',url));if(r.ok)break;}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
 }
 report.runtime=await (await fetch(new URL('/api/runtime-config',url))).json();
 assert.equal(report.runtime.source.repoRoot,resolve('.'));assert.equal(report.runtime.source.commit,report.source.rev);
 report.executable='/Users/noahlyons/.local/state/kaminos/browser-cache/cft154-verified-0930/chrome/mac_arm-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 browser=await launchChrome(report.executable,['--use-angle=metal','--window-size=1200,900'],report,{profileDir:out+'/profile'});
 report.phase='load';await save();
 await browser.navigate(url,'Boolean(window.__kaminosVolumePrototype && window.kaminosSceneAuthoring && window.kaminosSceneEdits)');
 await browser.evaluate(`window.__editWait=(target,loaded=false)=>new Promise((resolve,reject)=>{const tick=()=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)return reject(Error(s.error));if(s.simStepCount>=target&&(!loaded||(s.sceneCollision?.effective==='mesh-voxel-solid'&&s.joinedExterior?.admitted&&s.joinedRendering?.enabled)))return resolve(s);requestAnimationFrame(tick);};tick();})`);
 await browser.evaluate('window.__editWait(15,true).then(()=>window.__kaminosVolumePrototype.setSimulationPaused(true))');
 report.before=await browser.evaluate('window.__kaminosVolumePrototype.debugState()');
 assert(report.before.joinedExterior?.admitted);assert(report.before.joinedRendering?.enabled);assert.equal(report.before.sceneCollision?.effective,'mesh-voxel-solid');
 report.scene=await browser.evaluate('window.kaminosSceneAuthoring.read()');
 const target=report.scene.objects.find(o=>o.type==='procedural-mesh'&&o.collision?.enabled);assert(target,'no marked obstacle');report.target=target;
 const evaluate=browser.evaluate,step=async count=>evaluate(`window.__editWait(window.__kaminosVolumePrototype.debugState().simStepCount+${count})`);
 const shot=async name=>{const r=await browser.send('Page.captureScreenshot',{format:'png'});assert(r.result?.data,'missing frame');await fs.writeFile(out+'/'+name+'.png',Buffer.from(r.result.data,'base64'));};
 await evaluate(`window.__kaminosSetActiveTab('volume');window.kaminosSetCameraDebugPose({position:[0,2,10],target:[0,2,0]});window._kaminosDirty();window.kaminosSceneEdits.begin(${JSON.stringify(target.id)},'Edit hold witness');window.__kaminosVolumePrototype.setSimulationPaused(false)`);
 report.phase='drag';await save();report.previews=[];
 for(const dx of [.05,.1,.15]){
  const pose={...target.transform,position:target.transform.position.map((v,a)=>v+(a===0?dx:0))};
  await evaluate(`window.kaminosSceneEdits.preview(${JSON.stringify(pose)})`);
  report.previews.push(await step(3));
 }
 if(mode==='resident')for(const [i,s] of report.previews.entries())assertResidentMotion(i?report.previews[i-1]:report.before,s);
 else for(const s of report.previews){assert.equal(s.joinedEditing?.held,true);assert.equal(s.joinedExterior.steps,report.before.joinedExterior.steps);assert.equal(s.sceneSolidGeometryBuilds,report.before.sceneSolidGeometryBuilds);assert.equal(s.joinedRendering.enabled,true);assert.equal(s.joinedExterior.generation,report.before.joinedExterior.generation);}
 await shot(mode==='resident'?'drag-resident':'drag-held');
 report.phase='commit';await save();await evaluate('window.kaminosSceneEdits.commit()');report.placed=await step(3);
 assert.equal(report.placed.joinedEditing.held,false);assert.equal(report.placed.joinedEditing.pending,false);
 assert(report.placed.joinedExterior.steps>report.before.joinedExterior.steps);
 if(mode==='held')assert.equal(report.placed.sceneSolidGeometryBuilds,report.before.sceneSolidGeometryBuilds+1);
 else assert.equal(report.placed.joinedExterior.topologyGeneration,report.before.joinedExterior.topologyGeneration);
 assert.equal(report.placed.joinedExterior.generation,report.before.joinedExterior.generation);
 report.phase='cancel';await save();
 await evaluate(`window.kaminosSceneEdits.begin(${JSON.stringify(target.id)},'Cancel witness');window.kaminosSceneEdits.preview(${JSON.stringify(target.transform)})`);
 report.cancelHeld=await step(3);
 if(mode==='resident')assertResidentMotion(report.placed,report.cancelHeld);
 else{assert.equal(report.cancelHeld.joinedEditing.held,true);assert.equal(report.cancelHeld.sceneSolidGeometryBuilds,report.placed.sceneSolidGeometryBuilds);}
 await evaluate('window.kaminosSceneEdits.cancel()');report.cancelled=await step(3);
 if(mode==='held')assert.equal(report.cancelled.sceneSolidGeometryBuilds,report.placed.sceneSolidGeometryBuilds);
 else assertResidentMotion(report.cancelHeld,report.cancelled);
 assert.equal(report.cancelled.joinedEditing.pending,false);
 await evaluate('window.__kaminosVolumePrototype.setSimulationPaused(true)');await shot('resumed');
 report.phase='emitter-boundary-preview';await save();
 const emitter=report.scene.objects.find(o=>o.type==='flame-emitter');assert(emitter);
 const outside={...emitter.transform,position:emitter.transform.position.map((v,a)=>v+(a===0?100:0))};
 report.emitterBefore=await evaluate('window.__kaminosVolumePrototype.debugState()');
 await evaluate(`window.kaminosSceneEdits.begin(${JSON.stringify(emitter.id)},'Source boundary witness');window.kaminosSceneEdits.preview(${JSON.stringify(outside)});window.__kaminosVolumePrototype.setSimulationPaused(false)`);
 report.emitterOutside=await step(3);
 assert.equal(report.emitterOutside.joinedEditing.held,true);assert.equal(report.emitterOutside.joinedBoundary.deferredAdmission.admitted,false);
 assert.equal(report.emitterOutside.immersedSource.effective.admitted,false,'outside source must remain disabled');
 assert.equal(report.emitterOutside.fluidStateResetCount,report.emitterBefore.fluidStateResetCount);
 assert.equal(report.emitterOutside.sceneSolidGeometryBuilds,report.emitterBefore.sceneSolidGeometryBuilds);
 assert.equal(report.emitterOutside.joinedExterior.steps,report.emitterBefore.joinedExterior.steps);
 assert.equal(report.emitterOutside.joinedRendering.enabled,true);
 await evaluate(`window.kaminosSceneEdits.preview(${JSON.stringify(emitter.transform)})`);report.emitterReturned=await step(3);
 assert.equal(report.emitterReturned.fluidStateResetCount,report.emitterBefore.fluidStateResetCount);
 await evaluate('window.kaminosSceneEdits.cancel()');report.emitterCancelled=await step(3);
 assert.equal(report.emitterCancelled.joinedEditing.pending,false);assert.equal(report.emitterCancelled.fluidStateResetCount,report.emitterBefore.fluidStateResetCount);
 assert(report.emitterCancelled.joinedExterior.steps>report.emitterBefore.joinedExterior.steps);
 report.phase='emitter-outside-placement';await save();
 await evaluate(`{const d=window.kaminosFlameDomain.read();window.kaminosFlameDomain.set({position:[d.translation[0]+.001,d.translation[1]+d.scale,d.translation[2]],rotation:[0,0,0],scale:[d.scale,d.scale,d.scale]});}`);
 assert.equal(await evaluate('window.kaminosFlameDomain.read().followSource'),false);
 await step(3);
 await evaluate(`window.kaminosSceneEdits.begin(${JSON.stringify(emitter.id)},'Outside placement');window.kaminosSceneEdits.preview(${JSON.stringify(outside)});window.kaminosSceneEdits.commit()`);
 report.emitterPlacedOutside=await step(3);
 assert.equal(report.emitterPlacedOutside.joinedBoundary.admitted,false);
 assert.equal(report.emitterPlacedOutside.immersedSource.effective.admitted,false);
 assert.equal(report.emitterPlacedOutside.joinedEditing.pending,false);
 report.emitterStandalone=await step(3);
 assert(report.emitterStandalone.simStepCount>report.emitterPlacedOutside.simStepCount);
 await evaluate(`window.kaminosSceneEdits.apply(${JSON.stringify(emitter.id)},${JSON.stringify(emitter.transform)},'Return source inside')`);
 report.emitterRejoined=await step(3);
 assert.equal(report.emitterRejoined.joinedBoundary.admitted,true);
 assert.equal(report.emitterRejoined.joinedEditing.pending,false);
 assert.equal(report.emitterRejoined.joinedGhosts.generation,report.emitterRejoined.simStepCount);
 await evaluate('window.__kaminosVolumePrototype.setSimulationPaused(true)');
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);if(browser)report.lastState=await browser.evaluate('window.__kaminosVolumePrototype?.debugState()').catch(()=>null);process.exitCode=1;}
finally{await browser?.close();if(server){server.kill('SIGTERM');await serverExit;}report.terminal=true;await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
