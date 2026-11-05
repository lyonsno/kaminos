// Real Kaminos authoring consumer, isolated browser and stores. No benchmark.
import fs from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
const [out,route]=process.argv.slice(2),water=route==='water',presetFile=water?null:route;assert(out,'output directory required');
const root=process.cwd(),report={status:'running',phase:'launch',root,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),errors:[],observations:[]};
await fs.mkdir(out,{recursive:true});const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();
let server,context,page;
try{
 const dirs={};for(const name of ['settings','sessions','layouts','scenes','profile','home']){dirs[name]=out+'/'+name;await fs.mkdir(dirs[name],{recursive:true});}
 await fs.mkdir(dirs.home+'/.local/state/gpu-greenroom/done',{recursive:true});
 if(presetFile){await fs.mkdir(dirs.settings+'/presets',{recursive:true});await fs.copyFile(presetFile,dirs.settings+'/presets/'+path.basename(presetFile));report.preset=presetFile;}
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const log=await fs.open(out+'/server.log','a');
 server=spawn('python3',['-u','serve.py',String(port),'--volume-settings-store',dirs.settings,'--no-shared-basin-store','--volume-basin-session-store',dirs.sessions,'--volume-cockpit-layout-store',dirs.layouts],{cwd:root,env:{...process.env,HOME:dirs.home,KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:dirs.scenes},stdio:['ignore',log.fd,log.fd]});await log.close();
 report.origin='http://127.0.0.1:'+port;report.serverPid=server.pid;await save();
 for(;;){if(server.exitCode!==null)throw Error('Server exited');try{const r=await fetch(report.origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(report.runtime.source.repoRoot,root);
 report.executable=process.env.KAMINOS_TEST_BROWSER;assert(report.executable&&!report.executable.includes('/Google Chrome.app/'),'independent test browser required');
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 context=await chromium.launchPersistentContext(dirs.profile,{executablePath:report.executable,headless:true,viewport:{width:1280,height:900},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=context.pages()[0];
 await page.exposeFunction('__recoveryGpuError',message=>report.errors.push(message));
 await page.addInitScript(()=>{const request=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...args){const device=await request.apply(this,args);device.addEventListener('uncapturederror',event=>window.__recoveryGpuError(event.error.message));return device;};});page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text()+' '+JSON.stringify(m.location()));});
 report.phase='load';await save();await page.goto(report.origin+'/index.html?workspace=workbench&device_loss_test=1');
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments&&window.kaminosDeviceRecovery);
 await page.evaluate(async()=>{await window.kaminosWorkbenchExperiments.open('material-study',{roughness:.37});window._kaminosDirty();});
 await page.getByRole('button',{name:'Frame comparison',exact:true}).click();
 if(presetFile){await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),path.basename(presetFile,'.json'));await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().frameCount>3);}
 if(water){await page.evaluate(async()=>{const id=await window.kaminosWaterSources.add();window.kaminosWaterSources.editSimulation({waterSampling:{...window.kaminosWaterSources.read().simulation.sampling,particleTarget:256}});await window.kaminosWaterSources.release(id);});}
 await page.evaluate(async()=>{const id=window.kaminosSceneAuthoring.addLight();await window.kaminosSceneAuthoring.setLight(id,{intensity:12});window.__recoveryLight=id;await window.kaminosSceneLightingPreparation.whenIdle();window.__recoveryEdits=window.kaminosSceneEdits;});
 await page.waitForTimeout(1200);
 report.phase='before';report.before=await page.evaluate(async()=>({experiment:await window.kaminosWorkbenchExperiments.read(),objects:window.kaminosSceneAuthoring.read(),edits:window.kaminosSceneEdits.state(),sameEdits:window.__recoveryEdits===window.kaminosSceneEdits,flame:window.__kaminosVolumePrototype?.debugState(),water:window.kaminosWaterSources.read(),recovery:window.kaminosDeviceRecovery.state(),gi:window.kaminosSceneGIDebugState()}));await page.screenshot({path:out+'/before.png'});await save();
 for(let i=1;i<=2;i++){
  report.phase='loss-'+i;await save();
  await page.evaluate(()=>{window.__recoveryWitnessCanvas??=document.getElementById('kaminos-host-renderer-canvas');window.kaminosLoseDevice();});
  await page.waitForFunction(i=>{const s=window.kaminosDeviceRecovery.state();if(s.phase==='failed')throw Error(s.error);return s.phase==='active'&&s.recoveries===i;},i);
  await page.waitForTimeout(1000);
  const state=await page.evaluate(async()=>({sameCanvas:window.__recoveryWitnessCanvas===document.getElementById('kaminos-host-renderer-canvas'),experiment:await window.kaminosWorkbenchExperiments.read(),objects:window.kaminosSceneAuthoring.read(),edits:window.kaminosSceneEdits.state(),sameEdits:window.__recoveryEdits===window.kaminosSceneEdits,flame:window.__kaminosVolumePrototype?.debugState(),water:window.kaminosWaterSources.read(),recovery:window.kaminosDeviceRecovery.state(),gi:window.kaminosSceneGIDebugState()}));
  assert(state.sameCanvas&&state.sameEdits);assert.deepEqual(state.objects,report.before.objects);assert.deepEqual(state.edits,report.before.edits);assert.equal(state.experiment.roughness,.37);assert(state.gi.sceneFrames>report.before.gi.sceneFrames);if(water){assert(state.water.runtime);assert(state.water.runtime.step>0);assert.equal(state.water.runtime.paused,false);}if(presetFile){assert(state.flame.active);assert(state.flame.frameCount>0);assert.equal(state.flame.error,null);}report.observations.push(state);await page.screenshot({path:out+'/after-'+i+'.png'});await save();
 }
 if(!presetFile){
  report.phase='replacement-unavailable';await save();
  await page.evaluate(()=>{window.__requestDeviceBeforeFailure=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async()=>{throw Error('witness adapter unavailable');};window.kaminosLoseDevice();});
  await page.waitForFunction(()=>window.kaminosDeviceRecovery.state().phase==='failed');
  report.failedReplacement=await page.evaluate(()=>({recovery:window.kaminosDeviceRecovery.state(),objects:window.kaminosSceneAuthoring.read()}));
  assert.match(report.failedReplacement.recovery.error,/witness adapter unavailable/);assert.deepEqual(report.failedReplacement.objects,report.before.objects);
  await page.screenshot({path:out+'/unavailable.png'});
  await page.evaluate(()=>{GPUAdapter.prototype.requestDevice=window.__requestDeviceBeforeFailure;return window.kaminosDeviceRecovery.retry();});
  await page.waitForFunction(()=>window.kaminosDeviceRecovery.state().phase==='active');
 }
 await page.evaluate(()=>window.kaminosSceneEdits.undo());
 await page.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());
 report.afterUndo=await page.evaluate(()=>window.kaminosSceneAuthoring.read());
 assert.notDeepEqual(report.afterUndo,report.before.objects,'Undo must still change the retained scene');
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure=String(error.stack||error);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context?.close();server?.kill('SIGTERM');await save();console.log(JSON.stringify(report));}
