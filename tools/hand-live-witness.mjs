import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
const {values:args}=parseArgs({options:Object.fromEntries(['url','fixture','output','browser','playwright','experiment'].map(k=>[k,{type:'string'}]))});
const out=resolve(args.output);mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'setup',input:'retained_camera_fixture_not_operator_live',fixture:args.fixture,url:args.url,browser:args.browser,errors:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let browser;
const isNewSession = (state, previous) => state.sessionId !== previous && state.running === true &&
  state.starting === false && state.received >= 2;
try {
  const {chromium}=await import(pathToFileURL(resolve(args.playwright)));
  browser=await chromium.launchPersistentContext(out+'/profile',{headless:true,executablePath:args.browser,
    recordVideo:{dir:out+'/video',size:{width:1600,height:1000}},
    viewport:{width:1600,height:1000},args:['--use-mock-keychain','--password-store=basic','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await page.addInitScript(fixture=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const video=document.createElement('video');video.muted=true;video.loop=true;video.src=fixture;
      await new Promise((res,rej)=>{video.onloadeddata=res;video.onerror=rej;video.load();});
      video.currentTime=10;await video.play();window.fixtureVideo=video;
      window.fixtureStream=video.captureStream();return window.fixtureStream;
    };
  },args.fixture);
  report.phase='open';save();await page.goto(args.url);
  await page.waitForFunction(id=>window.kaminosWorkbenchExperiments?.state().id===id,args.experiment??'hand-live');
  const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  report.initial=await read();assert.equal(report.initial.running,false);
  const endpoint=report.initial.endpoint.replace(/\/$/,'');
  const cors={'Access-Control-Allow-Origin':new URL(args.url).origin};
  await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>=5);
  report.phase='visible_mesh';report.live=await read();save();
  assert.equal(report.live.visible,true);assert.equal(report.live.interactionAuthority,false);
  if(report.live.fingerJuice.enabled){
    assert.equal(report.live.fingerJuice.runtime.failure,null);
    assert(report.live.fingerJuice.runtime.frameCount>0);
    assert.equal(report.live.fingerJuice.runtime.effectiveRoute,'kaminos/finger-fluid/local-analytic-host-frame-v0');
    assert.equal(report.live.fingerJuice.packet.route_identity,'mobrecon-native-mesh-finger-juice-v1');
    assert(report.live.fingerJuice.packet.emitters.some(e=>e.active),'fixture produced no jets');
  }
  await page.screenshot({path:out+'/desktop.png'});
  if(report.live.fingerJuice.enabled){
    report.phase='water_controls';save();
    const session=report.live.sessionId;
    await page.getByRole('spinbutton',{name:'Emission / second',exact:true}).fill('3000');
    await page.getByRole('spinbutton',{name:'Emission / second',exact:true}).press('Tab');
    await page.waitForFunction(()=>document.querySelector('[data-hand-water-load]')?.textContent.includes('pool limited'));
    report.smallPool=await read();
    assert.equal(report.smallPool.fingerJuice.load.requestedRate,3000);
    assert.equal(report.smallPool.fingerJuice.load.mountedParticleCount,2400);
    await page.getByRole('spinbutton',{name:'Particle capacity',exact:true}).fill('9600');
    await page.getByRole('spinbutton',{name:'Particle capacity',exact:true}).press('Tab');
    await page.waitForFunction(()=>/9,600 allocated \| [1-9][\d,]*\/s admitted/.test(document.querySelector('[data-hand-water-load]')?.textContent));
    report.largePool=await read();
    assert.equal(report.largePool.sessionId,session,'capacity change restarted the camera session');
    assert.equal(report.largePool.running,true);
    assert.equal(report.largePool.fingerJuice.runtime.solver.particleCount,9600);
    assert.equal(report.largePool.fingerJuice.packet.economics.requestedParticleCount,9600);
    assert(report.largePool.fingerJuice.load.admittedRate>report.smallPool.fingerJuice.load.admittedRate*2,'larger pool did not admit more emission');
    report.loadLabel=await page.locator('[data-hand-water-load]').textContent();
    assert.match(report.loadLabel,/9,600 allocated/);
    await page.screenshot({path:out+'/controls.png'});
    await page.evaluate(async()=>{
      await window.kaminosWorkbenchExperiments.invoke('setParticleCount',2400);
      await window.kaminosWorkbenchExperiments.invoke('setSourceFlux',360);
    });
  }
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
    if(report.miss.fingerJuice.enabled)assert.equal(report.miss.fingerJuice.packet.emitters.some(e=>e.active),false);
    assert.equal(report.miss.acquisitionDetails.captureId,report.miss.captureId);assert.equal(report.miss.acquisitionDetails.detectorThreshold,1);
    await page.screenshot({path:out+'/miss.png'});
    await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setAcquisition',{mode:'detector',threshold:.18}));
    await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('YOLO / MLX crop'));
    report.reacquired=await read();assert.equal(report.reacquired.acquisition,'wilor_yolo_detector_bbox_only');
    assert.equal(report.reacquired.acquisitionDetails.captureId,report.reacquired.captureId);assert.equal(report.reacquired.acquisitionDetails.detectorThreshold,.18);
  }
  await page.route(endpoint+'/frame',route=>route.fulfill({status:503,contentType:'application/json',
    headers:cors,body:JSON.stringify({error:'witness_inference_failure'})}));
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('witness_inference_failure'));
  report.failure=await read();assert.equal(report.failure.running,false);assert.equal(report.failure.visible,true);
  if(report.failure.fingerJuice.enabled)assert.equal(report.failure.fingerJuice.packet.emitters.some(e=>e.active),false);
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
  await page.unroute(endpoint+'/frame');
  assert.equal(isNewSession(report.failure,report.live.sessionId),false);
  assert.equal(isNewSession({...report.failure,starting:true},report.live.sessionId),false);
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('start'));
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>=2);
  report.restart=await read();assert.notEqual(report.restart.sessionId,report.live.sessionId);
  assert(isNewSession(report.restart,report.live.sessionId));
  if(report.restart.fingerJuice.enabled){
    report.expiry=await page.evaluate(()=>{
      window.kaminosWaterSources.reset();
      return window.kaminosWorkbenchExperiments.read();
    });
    assert.match(report.expiry.fingerJuice.error,/expired/);
    assert.equal(report.expiry.fingerJuice.runtime,null);
    assert.equal(report.expiry.visible,true,'water expiry hid diagnostic mesh');
  }
  await page.getByRole('button',{name:'Stop camera',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('STOPPED'));
  report.stopped=await read();assert.equal(report.stopped.running,false);assert.equal(report.stopped.camera,null);
  report.stoppedTracks=await page.evaluate(()=>window.fixtureStream.getTracks().map(track=>track.readyState));
  assert(report.stoppedTracks.length>0&&report.stoppedTracks.every(state=>state==='ended'),'camera survived stop after water expiry');
  await page.setViewportSize({width:430,height:932});
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('frame'));
  await page.screenshot({path:out+'/mobile.png'});
  await page.route(endpoint+'/frame',route=>route.abort('connectionfailed'));
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
  await page.route(endpoint+'/event',route=>route.abort('connectionfailed'));
  report.closeFailure=await page.evaluate(async()=>{
    try {await window.kaminosWorkbenchExperiments.close();return null;}catch(error){return String(error);}
  });
  assert(report.closeFailure,'backend loss must remain visible');
  report.registryAfterClose=await page.evaluate(()=>window.kaminosSceneObjectDebugState());
  assert.equal(report.registryAfterClose.filter(row=>row.label==='MobRecon native diagnostic').length,0,'backend loss leaked registered mesh');
  await page.unroute(endpoint+'/frame');await page.unroute(endpoint+'/event');
  assert.equal(await page.evaluate(()=>window.kaminosLocalLiquidState().mounted),false,'closed experiment leaked water host');
  report.reopened=await page.evaluate(id=>window.kaminosWorkbenchExperiments.open(id),args.experiment??'hand-live');
  assert.equal(report.reopened.running,false);assert.equal(report.reopened.visible,false);
  report.registryAfterReopen=await page.evaluate(()=>window.kaminosSceneObjectDebugState());
  assert.equal(report.registryAfterReopen.filter(row=>row.label==='MobRecon native diagnostic').length,1,'reopen duplicated mesh');
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase=null;
} catch(error){report.error=String(error);process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;save();}
