// Actual authoring consumer; isolated writable stores; no timing verdict.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {validateOpticalPreviewArm} from '../volume-optical-native.mjs';
const [out,presetFile]=process.argv.slice(2);
assert.ok(out&&presetFile,'Caller-owned output and observed preset required');
await fs.mkdir(out,{recursive:true});
const materialWidth=Number(process.argv.find(a=>a.startsWith('--material-width='))?.split('=')[1]??32);
const root=process.cwd(),report={status:'failed',phase:'setup',root,errors:[],arms:[]};
let server,browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let sourceFiles;
const discoverSources=()=>execFileSync('git',['ls-files','-co','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(f=>/^(volume-|activity-grid-witness|fine-grid-witness|flame-authoring|index.html|scene-fire-schema|tools\/(three-grid-scene|grid-editor|fine-grid-witness))/.test(f));
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex')])));
try{
 assert.ok(Number.isInteger(materialWidth)&&materialWidth>=4);
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
 page.on('pageerror',e=>{report.errors.push(String(e));void save();});page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void save();}});
 report.phase='load';await save();await page.goto(origin+'/index.html?workspace=authoring');
 await page.waitForFunction(()=>window.kaminosSceneAuthoring?.addFlameEmitter);
 report.phase='scene-create';await save();
 await page.evaluate(id=>window.kaminosSceneAuthoring.addFlameEmitter(id),path.basename(presetFile,'.json'));
 const control=async(id,value)=>page.evaluate(({id,value})=>{const e=document.getElementById(id);if(!e)throw Error('Missing '+id);e.value=String(value);if(e.value!==String(value))throw Error('Rejected '+id);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
 for(const [id,v] of Object.entries({'volume-look-freeze':1,'volume-resolution':materialWidth,'volume-grid-height-ratio':2,'volume-render-scale':.35,'volume-steps':8,'volume-pressure-solver-iterations':12,'volume-world-smoke':'on','volume-world-smoke-flow':materialWidth/4,'volume-world-smoke-material':materialWidth/2,'volume-world-smoke-pressure':materialWidth/8,'volume-world-smoke-iterations':12,'volume-intermediate-flow':materialWidth*3/8,'volume-intermediate-material':materialWidth*3/4,'volume-intermediate-pressure':materialWidth*3/16,'volume-intermediate-iterations':12,'volume-intermediate-extent':1.5}))await control(id,v);
 await page.evaluate(()=>{window.selectSceneField('flame-field');window.kaminosSetCameraDebugPose({position:[10,6,13],target:[0,3,0]});});

 report.phase='field-dispatch';await save();await control('volume-look-freeze',0);
 await page.waitForFunction(()=>{const s=window.__kaminosVolumePrototype?.debugState();if(s?.error)throw Error(s.error);return s?.worldSmoke?.effective==='one-way-world-field'&&s.simStepCount>=8;});
 await control('volume-look-freeze',1);
 report.frozen=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
 await page.locator('#info-bar').evaluate(e=>e?.blur()).catch(()=>{});
 for(const mode of ['budgeted','joins','history']){
  report.phase='render-'+mode;await save();await control('volume-raymarch-mode',mode);
  for(let draw=0;draw<2;draw++){
   const arm=await page.evaluate(async()=>{
    const r=window.__kaminosVolumePrototype;
    const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
    const state=r.debugState();const frame=sample.image;
    let png=null;
    if(frame?.rgba){const c=document.createElement('canvas');c.width=frame.width;c.height=frame.height;c.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(frame.rgba),frame.width,frame.height),0,0);png=c.toDataURL('image/png');}
    return {sample,state,png};
   });
   validateOpticalPreviewArm(arm.sample,arm.state,{mode,tolerance:.001,step:report.frozen.simStepCount,raySteps:8});
   const name=mode+'-'+draw,rgba=Buffer.from(arm.sample.image.rgba);
   await fs.writeFile(path.join(out,name+'.rgba'),rgba);
   await fs.writeFile(path.join(out,name+'.png'),Buffer.from(arm.png.split(',')[1],'base64'));
   report.arms.push({name,state:arm.state,width:arm.sample.image.width,height:arm.sample.image.height,sha256:createHash('sha256').update(rgba).digest('hex')});await save();
  }
 }
 report.phase='history-readback';await save();
 const guidance=await page.evaluate(async()=>{const g=await window.__kaminosVolumePrototype.sampleRayAllocationHistory();return {...g,previous:[...g.previous],observations:[...g.observations]};});
 assert.equal(guidance.state.geometry.cells,guidance.previous.length);assert.equal(guidance.observations.length,guidance.previous.length);
 assert.ok(guidance.previous.some(n=>n>0),'history contains actual last-draw observations');assert.ok(guidance.observations.some(n=>n>0),'current draw writes actual observations');
 for(const key of ['previous','observations'])await fs.writeFile(path.join(out,key+'.u32'),Buffer.from(Uint32Array.from(guidance[key]).buffer));
 report.guidance={...guidance,previous:undefined,observations:undefined,previousNonzero:guidance.previous.filter(n=>n>0).length,observationsNonzero:guidance.observations.filter(n=>n>0).length};
 await page.screenshot({path:path.join(out,'scene.png')});
 report.phase='return-to-original';await save();await control('volume-raymarch-mode','current');
 await page.evaluate(()=>window.__kaminosVolumePrototype.sampleFrame({advanceSim:false,now:4000}));
 report.returned=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());assert.equal(report.returned.opticalStepping.effective,'current');
 assert.equal(report.returned.simStepCount,report.frozen.simStepCount);
 assert.deepEqual(report.errors,[]);assert.deepEqual(await hashes(),report.source,'Source changed during run');report.status='passed';report.phase='complete';
}catch(e){report.error=e.stack;if(page)try{report.failureState=await page.evaluate(()=>window.__kaminosVolumePrototype?.debugState());await page.screenshot({path:path.join(out,'failure.png')});}catch(c){report.captureError=String(c);}process.exitCode=1;}
finally{await browser?.close();if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await stopped;}report.browserClosed=true;report.serverClosed=true;await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));
