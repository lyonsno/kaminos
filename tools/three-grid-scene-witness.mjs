// Actual authoring consumer; isolated writable stores; no timing verdict.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateFineGridWitness} from './fine-grid-witness-contract.mjs';
const [out,presetFile]=process.argv.slice(2);
assert.ok(out&&presetFile,'Caller-owned output and observed preset required');
await fs.mkdir(out,{recursive:true});
const root=process.cwd(),report={status:'failed',phase:'setup',root,errors:[],arms:[]};
let server,browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const sourceFiles=execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|fine-grid-witness|flame-authoring|index.html|scene-fire-schema|tools\/(three-grid-scene|fine-grid-witness))/.test(f));
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex')])));
try{
 report.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.source=await hashes();
 const dirs=Object.fromEntries(['home','settings','sessions','layouts','scenes','profile'].map(k=>[k,path.join(out,k)]));
 for(const d of Object.values(dirs))await fs.mkdir(d,{recursive:true});
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
 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':32,'volume-grid-height-ratio':2,'volume-render-scale':.5,'volume-steps':8,'volume-pressure-solver-iterations':12,'volume-world-smoke':'on','volume-world-smoke-flow':8,'volume-world-smoke-material':16,'volume-world-smoke-pressure':4,'volume-world-smoke-iterations':12,'volume-intermediate-flow':12,'volume-intermediate-material':24,'volume-intermediate-pressure':6,'volume-intermediate-iterations':12,'volume-intermediate-extent':1.5}))await control(id,v);
 await page.evaluate(()=>{window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[10,6,13],target:[0,3,0]});});
 for(const [name,middle,velocity,pressure] of [['middle','fields',0,0],['all-three','fields',16,8],['pressure-quarter','fields',16,4],['baseline','off',0,0]]){
  report.phase=name;await save();await control('volume-look-freeze',1);await control('volume-world-smoke-intermediate',middle);await control('volume-fine-velocity',velocity);await control('volume-fine-pressure',pressure);
  const step=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);await control('volume-look-freeze',0);
  await page.waitForFunction(step=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)throw Error(s.error);return s.simStepCount>=step+8;},step);
  await control('volume-look-freeze',1);const state=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());report.arms.push({name,state});await save();
  assert.match(state.backend,/^webgpu:/i);assert.doesNotMatch(state.backend,/software|swiftshader/i);assert.equal(state.worldSmoke.effective,'one-way-world-field');
  if(middle==='fields')assert.equal(state.worldSmoke.intermediate.effective,'independent-material-and-flow');
  if(velocity){assert.deepEqual(state.fineGrid.velocityDims,[velocity,velocity*2,velocity]);assert.equal(state.fineGrid.dispatched,true);assert.deepEqual(state.pressureResolution.pressureDims,[pressure,pressure*2,pressure]);}
  await page.screenshot({path:path.join(out,name+'.png')});
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
