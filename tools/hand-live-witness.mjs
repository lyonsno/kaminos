import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
const {values:args}=parseArgs({options:Object.fromEntries(['url','fixture','output','browser','playwright'].map(k=>[k,{type:'string'}]))});
const out=resolve(args.output);mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'setup',input:'retained_camera_fixture_not_operator_live',fixture:args.fixture,url:args.url,browser:args.browser,errors:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let browser;
const isNewSession = (state, previous) => state.sessionId !== previous && state.running === true &&
  state.starting === false && state.received >= 2;
try {
  const {chromium}=await import(pathToFileURL(resolve(args.playwright)));
  browser=await chromium.launchPersistentContext(out+'/profile',{headless:true,executablePath:args.browser,
    viewport:{width:1600,height:1000},args:['--use-mock-keychain','--password-store=basic','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await page.addInitScript(fixture=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const video=document.createElement('video');video.muted=true;video.loop=true;video.src=fixture;
      await new Promise((res,rej)=>{video.onloadeddata=res;video.onerror=rej;video.load();});
      video.currentTime=10;await video.play();window.fixtureVideo=video;
      return video.captureStream();
    };
  },args.fixture);
  report.phase='open';save();await page.goto(args.url);
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='hand-live');
  const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  report.initial=await read();assert.equal(report.initial.running,false);
  await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>=5);
  report.phase='visible_mesh';report.live=await read();save();
  assert.equal(report.live.visible,true);assert.equal(report.live.interactionAuthority,false);
  await page.screenshot({path:out+'/desktop.png'});
  const first=await page.locator('#kaminos-host-renderer-canvas').screenshot();
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>8);
  const second=await page.locator('#kaminos-host-renderer-canvas').screenshot();
  assert.notDeepEqual(first,second,'live mesh pixels did not change');
  writeFileSync(out+'/mesh.png',second);
  if(report.initial.acquisitionMode==='detector') {
    assert.equal(report.live.identity.detector.poseModelLoaded,false);
    assert.equal(report.live.acquisition,'wilor_yolo_detector_bbox_only');
    assert.equal(report.live.acquisitionDetails.cropPadding,1.4);
    await page.getByRole('combobox',{name:'Crop mode',exact:true}).selectOption('manual');
    await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('| MANUAL CROP |'));
    report.manual=await read();assert.equal(report.manual.acquisition,'operator_selected_crop_no_detector');assert.equal(report.manual.acquisitionDetails.mode,'manual');await page.screenshot({path:out+'/manual.png'});
    await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setAcquisition',{mode:'detector',threshold:1}));
    assert.equal(await page.getByRole('combobox',{name:'Crop mode',exact:true}).inputValue(),'detector');
    assert.equal(await page.getByRole('spinbutton',{name:'Detector threshold',exact:true}).inputValue(),'1');
    await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('NO DETECTION: MANUAL CROP FALLBACK'));
    report.miss=await read();assert.equal(report.miss.visible,true);assert.equal(report.miss.acquisitionDetails.fallback,true);
    assert.equal(report.miss.acquisitionDetails.captureId,report.miss.captureId);assert.equal(report.miss.acquisitionDetails.detectorThreshold,1);
    await page.screenshot({path:out+'/miss.png'});
    await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setAcquisition',{mode:'detector',threshold:.18}));
    await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('YOLO / MLX crop'));
    report.reacquired=await read();assert.equal(report.reacquired.acquisition,'wilor_yolo_detector_bbox_only');
    assert.equal(report.reacquired.acquisitionDetails.captureId,report.reacquired.captureId);assert.equal(report.reacquired.acquisitionDetails.detectorThreshold,.18);
  }
  await page.route('http://127.0.0.1:8791/frame',route=>route.fulfill({status:503,contentType:'application/json',
    headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:8498'},body:JSON.stringify({error:'witness_inference_failure'})}));
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('witness_inference_failure'));
  report.failure=await read();assert.equal(report.failure.running,false);assert.equal(report.failure.visible,true);
  report.failedSubmission=await page.evaluate(async()=>{
    const opened=indexedDB.open('hand-live-diagnostic',1);
    const db=await new Promise((resolve,reject)=>{opened.onsuccess=()=>resolve(opened.result);opened.onerror=()=>reject(opened.error);});
    try {
      if(!db.objectStoreNames.contains('captures')) return null;
      const request=db.transaction('captures').objectStore('captures').getAll();
      return await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result.find(x=>x.outcome?.state==='failed'));request.onerror=()=>reject(request.error);});
    } finally {db.close();}
  });
  assert(report.failedSubmission?.request?.image,'failed transport lost submitted image');
  assert.equal(report.failedSubmission.request.captureId,report.failedSubmission.captureId);
  const beforeAge=report.failure.captureAgeMs;
  await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+5000;});
  await page.waitForFunction(age=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/sample age (\d+) ms/)?.[1])>age+4000,beforeAge);
  await page.screenshot({path:out+'/failure.png'});
  await page.unroute('http://127.0.0.1:8791/frame');
  assert.equal(isNewSession(report.failure,report.live.sessionId),false);
  assert.equal(isNewSession({...report.failure,starting:true},report.live.sessionId),false);
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('start'));
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>=2);
  report.restart=await read();assert.notEqual(report.restart.sessionId,report.live.sessionId);
  assert(isNewSession(report.restart,report.live.sessionId));
  await page.getByRole('button',{name:'Stop camera',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('STOPPED'));
  report.stopped=await read();assert.equal(report.stopped.running,false);assert.equal(report.stopped.camera,null);
  await page.setViewportSize({width:430,height:932});
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('frame'));
  await page.screenshot({path:out+'/mobile.png'});
  await page.route('http://127.0.0.1:8791/frame',route=>route.abort('connectionfailed'));
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('start'));
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('Failed to fetch'));
  report.transportFailure=await page.evaluate(async()=>{
    const opened=indexedDB.open('hand-live-diagnostic',1);
    const db=await new Promise((resolve,reject)=>{opened.onsuccess=()=>resolve(opened.result);opened.onerror=()=>reject(opened.error);});
    try {
      const request=db.transaction('captures').objectStore('captures').getAll();
      return await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result.find(x=>x.outcome?.error?.includes('Failed to fetch')));request.onerror=()=>reject(request.error);});
    } finally {db.close();}
  });
  assert(report.transportFailure?.request?.image,'connection failure lost source pixels');
  await page.route('http://127.0.0.1:8791/event',route=>route.abort('connectionfailed'));
  report.closeFailure=await page.evaluate(async()=>{
    try {await window.kaminosWorkbenchExperiments.close();return null;}catch(error){return String(error);}
  });
  assert(report.closeFailure,'backend loss must remain visible');
  report.registryAfterClose=await page.evaluate(()=>window.kaminosSceneObjectDebugState());
  assert.equal(report.registryAfterClose.filter(row=>row.label==='MobRecon native diagnostic').length,0,'backend loss leaked registered mesh');
  await page.unroute('http://127.0.0.1:8791/frame');await page.unroute('http://127.0.0.1:8791/event');
  report.reopened=await page.evaluate(()=>window.kaminosWorkbenchExperiments.open('hand-live'));
  assert.equal(report.reopened.running,false);assert.equal(report.reopened.visible,false);
  report.registryAfterReopen=await page.evaluate(()=>window.kaminosSceneObjectDebugState());
  assert.equal(report.registryAfterReopen.filter(row=>row.label==='MobRecon native diagnostic').length,1,'reopen duplicated mesh');
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase=null;
} catch(error){report.error=String(error);process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;save();}
