import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {MLS_ROUTE,analyzeMlsParticles} from '../mls-juice-contract.mjs';
import {bindMlsWitnessSource,validateMlsHandWindow,resolveMlsHandRequest,validateMlsHandRequest,validateMlsJetControl,MLS_WITNESS_FILES} from './mls-witness-source.mjs';

const {values:a}=parseArgs({options:Object.fromEntries(['url','output','browser','playwright','capture','seconds','min-active','observe-seconds','width','height','scale','canvas-width','canvas-height','jet-control-speed'].map(k=>[k,{type:'string'}]))});
const out=path.resolve(a.output);fs.mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'input',at:new Date().toISOString(),argv:process.argv,pageErrors:[],consoleErrors:[],states:[],browserClosed:false,
  seconds:Number(a.seconds??0),minActive:Number(a['min-active']??1),observeSeconds:Number(a['observe-seconds']??0),
  scope:'retained real camera frame replayed into full browser hand/MLS/recording route; callback spacing is not GPU time or live pose/latency acceptance'};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let context,page;
try{
  fs.copyFileSync(new URL(import.meta.url),out+'/witness.mjs');
  fs.copyFileSync(new URL('./mls-witness-source.mjs',import.meta.url),out+'/witness-source.mjs');
  const capture=JSON.parse(fs.readFileSync(a.capture)),image=Buffer.from(capture.request.image,'base64');
  report.cameraSource={file:a.capture,captureId:capture.captureId,sha256:createHash('sha256').update(image).digest('hex')};fs.writeFileSync(out+'/source.png',image);
  report.requested=JSON.parse(new URL(a.url).searchParams.get('experiment_inputs')??'{}');
  report.experiment=new URL(a.url).searchParams.get('experiment')??'hand-browser-juice';
  report.resolvedRequest=resolveMlsHandRequest(report.experiment,report.requested);
  assert(Number.isFinite(report.seconds)&&report.seconds>=0,'invalid warmup');
  assert(Number.isFinite(report.observeSeconds)&&report.observeSeconds>=0,'invalid observation window');
  const viewport={width:Number(a.width??1280),height:Number(a.height??900)},scale=Number(a.scale??1);
  assert(Object.values(viewport).every(v=>Number.isSafeInteger(v)&&v>0)&&Number.isFinite(scale)&&scale>0,'invalid viewport');
  report.browserExecutable=fs.realpathSync(a.browser);assert(!report.browserExecutable.includes('/Google Chrome.app/'));
  const {chromium}=await import(pathToFileURL(a.playwright));report.phase='browser';save();
  context=await chromium.launchPersistentContext(out+'/profile',{executablePath:a.browser,headless:true,viewport,deviceScaleFactor:scale,
    recordVideo:{dir:out+'/video',size:viewport},args:['--use-mock-keychain','--password-store=basic','--autoplay-policy=no-user-gesture-required']});
  page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  const verifySource=bindMlsWitnessSource({page,url:a.url,root:process.cwd(),files:[...MLS_WITNESS_FILES,'experiments/hand-live.experiment.mjs','experiments/hand-browser-juice.experiment.mjs','experiments/hand-live-fluid.mjs',...(report.experiment==='hand-jet-runway'?['experiments/hand-jet-runway.experiment.mjs']:[])],out,report});
  await page.route('**/__mls-camera.png',route=>route.fulfill({contentType:'image/png',body:image}));
  await page.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const image=new Image();image.src='/__mls-camera.png';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const stream=canvas.captureStream(30);
      const draw=()=>{if(stream.getTracks().some(t=>t.readyState==='live')){ctx.drawImage(image,0,0);requestAnimationFrame(draw);}};draw();return stream;
    };
  });
  report.phase='load';save();await page.goto(a.url);await page.waitForFunction(id=>window.kaminosWorkbenchExperiments?.state().id===id,report.experiment);
  report.initial=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  assert.equal(report.initial.identity.backend,'webgpu-local');
  assert.equal(report.initial.fingerJuice.backend,'mls-mpm');
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('start'));report.phase='hand-and-water';save();
  await verifySource();save();
  let state;
  do{
    state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());report.states.push({at:Date.now(),state});
    assert.equal(state.error,null);assert.equal(state.fingerJuice.error,null);assert.equal(state.fingerJuice.runtime?.failure,null);
    if(state.received>=12&&state.fingerJuice.runtime.solver.liveInlets.totalAdmitted>0&&state.fingerJuice.runtime.solver.clock.simulatedSeconds>=report.seconds)break;
    await page.waitForTimeout(100);
  }while(true);
  report.observed=state;assert.equal(state.fingerJuice.runtime.effectiveRoute,MLS_ROUTE);assert.equal(state.visible,true);
  const solver=state.fingerJuice.runtime.solver;
  validateMlsHandRequest(state,report.resolvedRequest);
  const nativeConfig={capacity:solver.particleCount,minActive:report.minActive,grid:solver.domain.gridDimensions,cell:solver.domain.cellSize};
  report.canvas=state.fingerJuice.runtime.lastFrame;
  if(a['canvas-width'])assert.equal(report.canvas.width,Number(a['canvas-width']),'canvas width mismatch');
  if(a['canvas-height'])assert.equal(report.canvas.height,Number(a['canvas-height']),'canvas height mismatch');
  if(report.observeSeconds){
    report.phase='populated-window';save();
    const warm=await page.evaluate(async()=>Array.from(await window.kaminosWorkbenchExperiments.invoke('snapshotWater')));
    fs.writeFileSync(out+'/particles-before-window.json',JSON.stringify(warm));
    report.populationBefore=analyzeMlsParticles(warm,nativeConfig);
    report.windowStart=await page.evaluate(async()=>{
      window.__mlsFrames={times:[],running:true};
      const tick=t=>{if(!window.__mlsFrames.running)return;window.__mlsFrames.times.push(t);requestAnimationFrame(tick);};requestAnimationFrame(tick);
      return {epochMs:Date.now(),state:await window.kaminosWorkbenchExperiments.read()};
    });
    await page.waitForTimeout(report.observeSeconds*1000);
    report.windowEnd=await page.evaluate(async()=>{window.__mlsFrames.running=false;return {epochMs:Date.now(),times:window.__mlsFrames.times,state:await window.kaminosWorkbenchExperiments.read()};});
    fs.writeFileSync(out+'/callback-times.json',JSON.stringify(report.windowEnd.times));
    const intervals=report.windowEnd.times.slice(1).map((t,i)=>t-report.windowEnd.times[i]).sort((a,b)=>a-b);
    assert(intervals.length>0,'missing populated-window callbacks');
    report.callbackSpacingMs=Object.fromEntries([['p50',.5],['p95',.95],['p99',.99]].map(([k,q])=>[k,intervals[Math.min(intervals.length-1,Math.floor(q*intervals.length))]]));
    report.progress=validateMlsHandWindow(report.windowStart.state,report.windowEnd.state);
  }
  if(a['jet-control-speed']){
    const speed=Number(a['jet-control-speed']);assert(Number.isFinite(speed)&&speed>=0,'invalid control probe speed');
    report.phase='jet-control';report.jetControl=[];save();
    for(const requestedSpeed of [speed,report.resolvedRequest.jetSpeed]){
      const before=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
      await page.getByRole('spinbutton',{name:'Jet speed',exact:true}).fill(String(requestedSpeed));
      await page.waitForFunction(({speed,received,frames,seconds})=>{
        const s=window.kaminosWorkbenchExperiments.read(),f=s.fingerJuice;
        if(s.error||f.error||f.runtime?.failure)throw Error(s.error??f.error??f.runtime.failure);
        return s.received>received&&f.runtime.frameCount>frames&&f.runtime.solver.clock.simulatedSeconds>seconds&&
          f.packet.economics?.jetSpeedWorldPerSecond===speed;
      },{speed:requestedSpeed,received:before.received,frames:before.fingerJuice.runtime.frameCount,seconds:before.fingerJuice.runtime.solver.clock.simulatedSeconds});
      const after=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
      report.jetControl.push({requestedSpeed,before,after});save();validateMlsJetControl(before,after,requestedSpeed);
    }
  }
  report.stopped=await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('stop'));
  assert.equal(report.stopped.running,false);assert.equal(report.stopped.retention.pending,0);assert.equal(report.stopped.retention.error,null);
  report.phase='native-state';save();
  const words=await page.evaluate(async()=>Array.from(await window.kaminosWorkbenchExperiments.invoke('snapshotWater')));
  fs.writeFileSync(out+'/particles.json',JSON.stringify(words));
  report.population=analyzeMlsParticles(words,nativeConfig);
  await page.screenshot({path:out+'/hand-and-water.png'});
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);
  report.video=await page.video().path();report.status='complete';report.phase='complete';
}catch(error){report.error=String(error);report.stack=error.stack;process.exitCode=1;
  if(page){try{report.failure=await page.evaluate(()=>({entry:window.kaminosWorkbenchExperiments?.state(),text:document.body.innerText}));await page.screenshot({path:out+'/failure.png'});report.failureStop=await page.evaluate(()=>window.kaminosWorkbenchExperiments?.invoke('stop'));}catch(cause){report.failureCaptureError=String(cause);}}
}finally{if(context){try{report.video=await page?.video()?.path();}catch{}await context.close();report.browserClosed=true;}save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:out+'/report.json'}));
