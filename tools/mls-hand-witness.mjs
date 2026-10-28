import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {MLS_ROUTE} from '../mls-juice-contract.mjs';
import {bindMlsWitnessSource,MLS_WITNESS_FILES} from './mls-witness-source.mjs';

const {values:a}=parseArgs({options:Object.fromEntries(['url','output','browser','playwright','capture'].map(k=>[k,{type:'string'}]))});
const out=path.resolve(a.output);fs.mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'input',at:new Date().toISOString(),argv:process.argv,pageErrors:[],consoleErrors:[],states:[],browserClosed:false,
  scope:'retained real camera frame replayed into full browser hand/MLS/recording route; not live pose/latency acceptance'};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let context,page;
try{
  const capture=JSON.parse(fs.readFileSync(a.capture)),image=Buffer.from(capture.request.image,'base64');
  report.source={file:a.capture,captureId:capture.captureId,sha256:createHash('sha256').update(image).digest('hex')};fs.writeFileSync(out+'/source.png',image);
  report.browserExecutable=fs.realpathSync(a.browser);assert(!report.browserExecutable.includes('/Google Chrome.app/'));
  const {chromium}=await import(pathToFileURL(a.playwright));report.phase='browser';save();
  context=await chromium.launchPersistentContext(out+'/profile',{executablePath:a.browser,headless:true,viewport:{width:1280,height:900},
    recordVideo:{dir:out+'/video',size:{width:1280,height:900}},args:['--use-mock-keychain','--password-store=basic','--autoplay-policy=no-user-gesture-required']});
  page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  const verifySource=bindMlsWitnessSource({page,url:a.url,root:process.cwd(),files:[...MLS_WITNESS_FILES,'experiments/hand-live.experiment.mjs','experiments/hand-browser-juice.experiment.mjs','experiments/hand-live-fluid.mjs'],out,report});
  await page.route('**/__mls-camera.png',route=>route.fulfill({contentType:'image/png',body:image}));
  await page.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const image=new Image();image.src='/__mls-camera.png';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const stream=canvas.captureStream(30);
      const draw=()=>{if(stream.getTracks().some(t=>t.readyState==='live')){ctx.drawImage(image,0,0);requestAnimationFrame(draw);}};draw();return stream;
    };
  });
  report.phase='load';save();await page.goto(a.url);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='hand-browser-juice');
  report.initial=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  assert.equal(report.initial.identity.backend,'webgpu-local');
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('start'));report.phase='hand-and-water';save();
  await verifySource();save();
  let state;
  do{
    state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());report.states.push({at:Date.now(),state});
    assert.equal(state.error,null);assert.equal(state.fingerJuice.error,null);assert.equal(state.fingerJuice.runtime?.failure,null);
    if(state.received>=12&&state.fingerJuice.runtime.solver.liveInlets.totalAdmitted>0)break;
    await page.waitForTimeout(100);
  }while(true);
  report.observed=state;assert.equal(state.fingerJuice.runtime.effectiveRoute,MLS_ROUTE);assert.equal(state.visible,true);
  await page.screenshot({path:out+'/hand-and-water.png'});
  report.stopped=await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('stop'));
  assert.equal(report.stopped.running,false);assert.equal(report.stopped.retention.pending,0);assert.equal(report.stopped.retention.error,null);
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);
  report.video=await page.video().path();report.status='complete';report.phase='complete';
}catch(error){report.error=String(error);report.stack=error.stack;process.exitCode=1;
  if(page){try{report.failure=await page.evaluate(()=>({entry:window.kaminosWorkbenchExperiments?.state(),text:document.body.innerText}));await page.screenshot({path:out+'/failure.png'});await page.evaluate(()=>window.kaminosWorkbenchExperiments?.invoke('stop')).catch(()=>{});}catch(cause){report.failureCaptureError=String(cause);}}
}finally{if(context){await context.close();report.browserClosed=true;}save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:out+'/report.json'}));
