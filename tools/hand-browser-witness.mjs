import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
const {values:a}=parseArgs({options:Object.fromEntries(['url','fixture','fixture-sha','output','browser','playwright'].map(k=>[k,{type:'string'}]))});
const out=resolve(a.output);mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'browser_launch',input:'retained_camera_not_operator_live',url:a.url,fixture:a.fixture,fixtureSha256:a['fixture-sha'],browser:a.browser,errors:[],consoleErrors:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let context;
try{
  const {chromium}=await import(pathToFileURL(resolve(a.playwright)));
  context=await chromium.launchPersistentContext(out+'/profile',{executablePath:a.browser,headless:true,
    viewport:{width:1600,height:1000},recordVideo:{dir:out+'/video',size:{width:1600,height:1000}},
    args:['--use-mock-keychain','--password-store=basic','--autoplay-policy=no-user-gesture-required']});
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  await page.addInitScript(({fixture,sha})=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const {verifyVideoResponse}=await import('/demos/hand-mesh/witness-input.js');
      const {blob,identity}=await verifyVideoResponse({response:await fetch(fixture),expectedSha256:sha,sourceUrl:fixture});
      window.handFixtureIdentity=identity;
      const video=document.createElement('video');video.muted=true;video.loop=true;video.src=URL.createObjectURL(blob);
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;video.load();});
      video.currentTime=10;await video.play();window.handFixtureVideo=video;
      window.handFixtureStream=video.captureStream();return window.handFixtureStream;
    };
  },{fixture:a.fixture,sha:a['fixture-sha']});
  report.phase='page_and_models';save();await page.goto(a.url);
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='hand-browser-juice');
  const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  report.initial=await read();assert.equal(report.initial.identity.backend,'webgpu-local');
  assert.equal(report.initial.identity.device,'browser-gpu');assert.equal(report.initial.endpoint,null);
  await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>=5);
  report.phase='shared_water';report.live=await read();save();
  await page.screenshot({path:out+'/initial-scene.png'});
  report.water=await page.evaluate(()=>window.kaminosLocalLiquidState());save();
  assert.equal(report.live.visible,true);assert.equal(report.live.fingerJuice.runtime.failure,null);
  assert.equal(report.live.fingerJuice.packet.route_identity,'mobrecon-browser-mesh-finger-juice-v1');
  assert.equal(report.live.fingerJuice.packet.source_identity.backend,'webgpu-local');
  assert(report.live.fingerJuice.packet.emitters.some(e=>e.active),'retained fixture produced no finger jets');
  report.fixturePlayed=await page.evaluate(()=>window.handFixtureIdentity);
  await page.screenshot({path:out+'/desktop.png'});
  const first=await page.locator('#kaminos-host-renderer-canvas').screenshot();
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>=40);
  const second=await page.locator('#kaminos-host-renderer-canvas').screenshot();
  assert.notDeepEqual(first,second,'shared hand/water pixels did not move');writeFileSync(out+'/motion.png',second);
  await page.getByRole('spinbutton',{name:'Particle capacity',exact:true}).fill('30000');
  await page.getByRole('spinbutton',{name:'Particle capacity',exact:true}).press('Tab');
  await page.waitForFunction(()=>document.querySelector('[data-hand-water-load]')?.textContent.includes('30,000 allocated'));
  await page.getByRole('spinbutton',{name:'Emission / second',exact:true}).fill('2000');
  await page.getByRole('spinbutton',{name:'Emission / second',exact:true}).press('Tab');
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>=60);
  report.loaded=await read();assert.equal(report.loaded.sessionId,report.live.sessionId);
  assert.equal(report.loaded.fingerJuice.load.mountedParticleCount,30000);
  assert.equal(report.loaded.fingerJuice.load.requestedRate,2000);
  await page.screenshot({path:out+'/loaded.png'});
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setAcquisition',{mode:'detector',threshold:1}));
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('NO DETECTION: MANUAL CROP FALLBACK'));
  report.miss=await read();assert.equal(report.miss.visible,true);assert.equal(report.miss.fingerJuice.packet.emitters.some(e=>e.active),false);
  await page.screenshot({path:out+'/miss.png'});
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setAcquisition',{mode:'detector',threshold:.18}));
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('YOLO / WebGPU crop'));
  report.reacquired=await read();
  await page.route('**/api/hand-record',route=>route.fulfill({status:503,body:'fixture retention failure'}));
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('retention failed'));
  report.failure=await read();assert.equal(report.failure.running,false);assert.equal(report.failure.visible,true);
  assert.equal(report.failure.fingerJuice.packet.emitters.some(e=>e.active),false);
  await page.unroute('**/api/hand-record');
  await page.setViewportSize({width:430,height:932});
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('frame'));
  await page.screenshot({path:out+'/mobile.png'});
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
  assert.equal(await page.evaluate(()=>window.kaminosLocalLiquidState().mounted),false);
  report.tracks=await page.evaluate(()=>window.handFixtureStream.getTracks().map(t=>t.readyState));
  assert(report.tracks.every(x=>x==='ended'));
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase=null;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{try{await context?.close();report.browserClosed=true;}finally{save();}}
