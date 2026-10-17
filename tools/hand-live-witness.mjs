import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
const {values:args}=parseArgs({options:Object.fromEntries(['url','fixture','output','browser','playwright'].map(k=>[k,{type:'string'}]))});
const out=resolve(args.output);mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'setup',input:'retained_camera_fixture_not_operator_live',fixture:args.fixture,url:args.url,browser:args.browser,errors:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let browser;
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
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('5 meshes'));
  report.phase='visible_mesh';report.live=await read();save();
  assert.equal(report.live.visible,true);assert.equal(report.live.interactionAuthority,false);
  await page.screenshot({path:out+'/desktop.png'});
  const first=await page.locator('#kaminos-host-renderer-canvas').screenshot();
  await page.waitForFunction(()=>Number(document.querySelector('[data-hand-live-status]')?.textContent.match(/(\d+) meshes/)?.[1])>8);
  const second=await page.locator('#kaminos-host-renderer-canvas').screenshot();
  assert.notDeepEqual(first,second,'live mesh pixels did not change');
  writeFileSync(out+'/mesh.png',second);
  await page.route('http://127.0.0.1:8791/frame',route=>route.fulfill({status:503,contentType:'application/json',
    headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:8498'},body:JSON.stringify({error:'witness_inference_failure'})}));
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('witness_inference_failure'));
  report.failure=await read();assert.equal(report.failure.running,false);assert.equal(report.failure.visible,true);
  await page.screenshot({path:out+'/failure.png'});
  await page.unroute('http://127.0.0.1:8791/frame');
  await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('2 meshes'));
  report.restart=await read();assert.notEqual(report.restart.sessionId,report.live.sessionId);
  await page.getByRole('button',{name:'Stop camera',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-hand-live-status]')?.textContent.includes('STOPPED'));
  report.stopped=await read();assert.equal(report.stopped.running,false);assert.equal(report.stopped.camera,null);
  await page.setViewportSize({width:430,height:932});
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('frame'));
  await page.screenshot({path:out+'/mobile.png'});
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase=null;
} catch(error){report.error=String(error);process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;save();}
