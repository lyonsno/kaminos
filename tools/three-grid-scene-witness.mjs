// Actual authoring consumer; isolated writable stores; no timing verdict.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {validateFineGridWitness} from './fine-grid-witness-contract.mjs';
const [out,presetFile]=process.argv.slice(2);
assert.ok(out&&presetFile,'Caller-owned output and observed preset required');
await fs.mkdir(out,{recursive:true});
const materialWidth=Number(process.argv.find(a=>a.startsWith('--material-width='))?.split('=')[1]??32);
const root=process.cwd(),report={status:'failed',phase:'setup',root,errors:[],arms:[]};
let server,browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let sourceFiles;
const discoverSources=()=>execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|activity-grid-witness|fine-grid-witness|flame-authoring|index.html|scene-fire-schema|tools\/(three-grid-scene|fine-grid-witness))/.test(f));
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex')])));
try{
 assert.ok(Number.isInteger(materialWidth)&&materialWidth>=16&&materialWidth%16===0,'Material width must be a multiple of sixteen');
 report.materialWidth=materialWidth;
 report.phase='source-discovery';report.source=null;await save();sourceFiles=discoverSources();
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.source=await hashes();
 const dirs=Object.fromEntries(['home','settings','sessions','layouts','scenes','profile'].map(k=>[k,path.join(out,k)]));
 for(const d of Object.values(dirs))await fs.mkdir(d,{recursive:true});
 await fs.mkdir(path.join(dirs.home,'.local/state/gpu-greenroom/done'),{recursive:true});
 await fs.mkdir(path.join(dirs.settings,'presets'),{recursive:true});await fs.copyFile(presetFile,path.join(dirs.settings,'presets',path.basename(presetFile)));
 report.preset={path:presetFile,sha256:createHash('sha256').update(await fs.readFile(presetFile)).digest('hex')};
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('KAMINOS_')));
 report.server={port,args:['-u','serve.py',String(port),'--volume-settings-store',dirs.settings,'--no-shared-basin-store','--volume-basin-session-store',dirs.sessions,'--volume-cockpit-layout-store',dirs.layouts]};
 const log=await fs.open(path.join(out,'server.log'),'a');
 server=spawn('python3',report.server.args,{cwd:root,env:{...env,HOME:dirs.home,KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:dirs.scenes},stdio:['ignore',log.fd,log.fd]});report.server.pid=server.pid;await log.close();
 report.phase='server';await save();const origin='http://127.0.0.1:'+port;report.origin=origin;
 for(;;){if(server.exitCode!==null)throw Error('Server exited '+server.exitCode);try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.sharedBasinStore,null);
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable?.includes('Google Chrome for Testing'));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launchPersistentContext(dirs.profile,{executablePath:report.executable,headless:true,viewport:{width:1100,height:800},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 browser.setDefaultTimeout(0);browser.setDefaultNavigationTimeout(0);page=await browser.newPage();
 page.on('response',r=>{if(r.status()>=400)report.errors.push(`HTTP ${r.status()} ${r.url()}`);});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='load';await save();await page.goto(origin+'/index.html?workspace=authoring');
 report.phase='fine-transfer';await save();
 report.fineTransfer=await page.evaluate(async()=>await(await import('/fine-grid-witness.mjs')).probeFineGrid());
 validateFineGridWitness(report.fineTransfer);await save();
 report.phase='activity-cue';await save();
 report.activityGrid=await page.evaluate(async()=>await(await import('/activity-grid-witness.mjs')).probeActivityGrid());await save();
 assert.deepEqual(report.activityGrid.errors,[]);
 for(const c of report.activityGrid.cases)for(let i=0;i<c.expected.length;i++)assert.ok(Math.abs(c.actual[i]-c.expected[i])<1e-5,'Activity cue physical location at ratio '+c.ratio);
 if(process.argv.includes('--probes-only')){assert.deepEqual(await hashes(),report.source);report.status='passed';report.phase='complete';}else{
 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 report.phase='scene-create';await save();
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':materialWidth,'volume-grid-height-ratio':2,'volume-render-scale':.5,'volume-steps':8,'volume-pressure-solver-iterations':12,'volume-world-smoke':'on','volume-world-smoke-flow':materialWidth/4,'volume-world-smoke-material':materialWidth/2,'volume-world-smoke-pressure':materialWidth/8,'volume-world-smoke-iterations':12,'volume-intermediate-flow':materialWidth*3/8,'volume-intermediate-material':materialWidth*3/4,'volume-intermediate-pressure':materialWidth*3/16,'volume-intermediate-iterations':12,'volume-intermediate-extent':1.5}))await control(id,v);
 await page.evaluate(()=>{window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[10,6,13],target:[0,3,0]});});
 for(const [name,middle,velocity,pressure] of [['middle','fields',0,0],['all-three','fields',materialWidth/2,materialWidth/4],['pressure-quarter','fields',materialWidth/2,materialWidth/8],['baseline','off',0,0]]){
  report.phase=name;await save();await control('volume-look-freeze',1);await control('volume-world-smoke-intermediate',middle);await control('volume-fine-velocity',velocity);await control('volume-fine-pressure',pressure);
  const step=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);await control('volume-look-freeze',0);
  await page.waitForFunction(step=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)throw Error(s.error);return s.simStepCount>=step+8;},step);
  await control('volume-look-freeze',1);const state=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());report.arms.push({name,state});await save();
  assert.match(state.backend,/^webgpu:/i);assert.doesNotMatch(state.backend,/software|swiftshader/i);assert.equal(state.worldSmoke.effective,'one-way-world-field');
  if(middle==='fields')assert.equal(state.worldSmoke.intermediate.effective,'independent-material-and-flow');
  if(velocity){assert.deepEqual(state.fineGrid.velocityDims,[velocity,velocity*2,velocity]);assert.equal(state.fineGrid.dispatched,true);assert.deepEqual(state.pressureResolution.pressureDims,[pressure,pressure*2,pressure]);}
  assert.equal(state.pressureSolver.residualProbe.available,!velocity,'Residual availability follows effective velocity route');
  assert.equal(state.pressureSolver.residualProbe.reason,velocity?'independent-velocity-residual-unavailable':null);
  await page.screenshot({path:path.join(out,name+'.png')});
 }
 report.phase='developed-plume';await save();
 await control('volume-world-smoke-intermediate','fields');await control('volume-fine-velocity',materialWidth/2);await control('volume-fine-pressure',materialWidth/4);
 await control('selected-world-smoke-overlay','bounds');
 const developStart=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);
 await control('volume-look-freeze',0);
 await page.waitForFunction(start=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)throw Error(s.error);return s.simStepCount>=start+180;},developStart);
 await control('volume-look-freeze',1);
 report.developed=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());await save();
 assert.equal(report.developed.pressureSolver.residual,null,'Independent velocity must not show an old shared-grid residual');
 assert.equal(report.developed.simCostLedger.coverage,'partial');assert.equal(report.developed.simCostLedger.fullGridPassesPerFrame,null);
 await page.screenshot({path:path.join(out,'developed.png')});
 report.phase='save';await save();
 report.saved=await page.evaluate(()=>window.saveSceneAs({result:true,name:'three-region-fields'}));assert.equal(report.saved.ok,true);
 const listing=await(await fetch(origin+'/api/browse?root=scenes&path=')).json();
 const sceneName=listing.entries.find(e=>e.name==='three-region-fields.kaminos.json')?.name;assert.ok(sceneName);
 const scene=await(await fetch(origin+'/api/read?root=scenes&path='+encodeURIComponent(sceneName))).json();
 await fs.writeFile(path.join(out,'scene.json'),JSON.stringify(scene,null,2));
 const expected=Object.fromEntries(['fineVelocity','finePressure','worldSmokePressure','worldSmokeIterations','intermediateFlow','intermediateMaterial','intermediatePressure','intermediateIterations','intermediateExtent','worldSmokeIntermediate'].map(k=>[k,report.developed.controls[k]]));
 report.phase='reopen';await save();await page.goto(compositionRestoreUrl(scene.composition,sceneName,origin));
 await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().controls?.worldSmokeIntermediate==='fields');
 report.reopened=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
 for(const [key,value] of Object.entries(expected))assert.equal(report.reopened.controls[key],value,'Saved setting '+key);
 await page.screenshot({path:path.join(out,'reopened.png')});
 assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');report.status='passed';report.phase='complete';
 }
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
