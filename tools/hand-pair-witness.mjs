// Camera consumer witness; raw JPEGs/results remain in both native session roots.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {values}=parseArgs({options:{url:{type:'string'},fixture:{type:'string'},browser:{type:'string'},playwright:{type:'string'},output:{type:'string'}}});
if(Object.values(values).length!==5)throw Error('--url --fixture --browser --playwright --output required');
const output=resolve(values.output);await mkdir(output,{recursive:true});
const report={input:'retained_camera_fixture_not_operator_live',status:'failed',phase:'browser_launch',url:values.url,browser:values.browser,fixture:values.fixture,stages:[],errors:[],lastTrustworthyEvidence:null};
const save=()=>writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');
await save();let context,page;
const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
try{
 const {chromium}=await import(pathToFileURL(resolve(values.playwright)));
 context=await chromium.launchPersistentContext(output+'/profile',{executablePath:values.browser,headless:true,viewport:{width:1600,height:1000},args:['--use-mock-keychain','--password-store=basic','--autoplay-policy=no-user-gesture-required']});
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.addInitScript(fixture=>{
  navigator.mediaDevices.getUserMedia=async()=>{
   window.fixtureVideo?.pause();
   const video=document.createElement('video');video.muted=true;video.loop=true;video.src=fixture;
   await new Promise((res,rej)=>{video.onloadeddata=res;video.onerror=()=>rej(Error('fixture video failed'));video.load();});
   video.currentTime=10;await video.play();window.fixtureVideo=video;
   window.fixtureStream=video.captureStream();return window.fixtureStream;
  };
 },values.fixture);
 report.phase='page_entry';await save();await page.goto(values.url);
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='hand-pair');
 report.initial=await read();assert.equal(report.initial.received,0);assert.equal(report.initial.fingerJuice.enabled,false);
 assert.equal(report.initial.models[0].identity.checkpointSha256,'2b634114dadb324802c9e55a8b7a9236f0e7b476157ac0b175f0eb258d9d276c');
 assert.equal(report.initial.models[1].identity.checkpointSha256,'84b3b434aaf63f77720ec4615116464ad36f85ec866268bc29e08435f86acfb1');
 report.runtime=await (await page.request.get(new URL('/api/runtime-config',values.url).href)).json();
 report.phase='live_pair';await save();await page.getByRole('button',{name:'Start camera',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('[data-hand-pair-status]')?.textContent.match(/(\d+) matched pairs/)?.[1])>=3 || document.querySelector('[data-hand-pair-status]')?.textContent.startsWith('Stopped:'));
 report.live=await read();assert.equal(report.live.error,null);assert(report.live.models.every(m=>m.visible));assert(report.live.received>=3);
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('stop'));
 report.stopped=await read();assert.equal(report.stopped.running,false);assert.equal(report.stopped.camera,null);
 await page.screenshot({path:output+'/paired-hands.png'});report.lastTrustworthyEvidence='paired-hands.png';report.stages.push('live_matched_pair_and_stop');await save();
 report.phase='source_replay';
 const rows=await page.evaluate(async()=>{
  const db=await new Promise((res,rej)=>{const q=indexedDB.open('hand-live-diagnostic',1);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});
  try{return await new Promise((res,rej)=>{const q=db.transaction('captures').objectStore('captures').getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}finally{db.close();}
 });
 assert(rows.some(r=>r.outcome.state==='computed'&&r.outcome.results?.length===2));
 await writeFile(output+'/retained-captures.json',JSON.stringify(rows,null,2)+'\n');
 for(const row of rows.filter(r=>r.outcome.state==='computed')){
  const [a,b]=row.outcome.results;assert.equal(a.captureId,b.captureId);assert.equal(a.captureId,row.captureId);assert.deepEqual(a.cropBox,b.cropBox);
  assert.equal(a.identity.checkpointSha256,report.initial.models[0].identity.checkpointSha256);assert.equal(b.identity.checkpointSha256,report.initial.models[1].identity.checkpointSha256);
 }
 report.stages.push('raw_source_and_both_results_retained');await save();
 report.phase='candidate_failure';
 const endpoint=report.initial.models[1].endpoint;
 await page.route(endpoint+'/frame',route=>route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':new URL(values.url).origin},body:JSON.stringify({error:'witness_candidate_failure'})}));
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('start'));
 await page.waitForFunction(()=>document.querySelector('[data-hand-pair-status]')?.textContent.startsWith('Stopped:'));
 report.failure=await read();assert.match(report.failure.error,/witness_candidate_failure/);assert.equal(report.failure.received,0);
 assert(report.failure.models.every(m=>!m.visible));assert.equal(report.failure.running,false);assert.equal(report.failure.camera,null);
 await page.unroute(endpoint+'/frame');report.stages.push('partial_pair_never_presented');await save();
 report.phase='stop_in_flight';
 let release,entered;const arrived=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await page.route(endpoint+'/frame',async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response});});
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('start'));await arrived;
 await page.evaluate(()=>{window.__pairStop=window.kaminosWorkbenchExperiments.invoke('stop');});
 const pending=await read();assert.equal(pending.running,false);release();await page.evaluate(()=>window.__pairStop);
 report.stopRace=await read();assert.equal(report.stopRace.received,0);assert(report.stopRace.models.every(m=>!m.visible));
 await page.unroute(endpoint+'/frame');report.stages.push('late_complete_pair_rejected_after_stop');await save();
 report.phase='reopen';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
 const registry=await page.evaluate(()=>window.kaminosSceneObjectDebugState());
 assert.equal(registry.filter(r=>/^(Original|Trained) hand/.test(r.label??'')).length,0);
 await page.goto(values.url);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='hand-pair');
 await page.reload();await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='hand-pair');
 report.reloaded=await read();assert.equal(report.reloaded.received,0);assert.equal(report.reloaded.running,false);assert.equal(report.reloaded.fingerJuice.enabled,false);
 assert.deepEqual(report.reloaded.models.map(m=>m.identity.checkpointSha256),report.initial.models.map(m=>m.identity.checkpointSha256));
 report.stages.push('cleanup_and_exact_url_reload');assert.deepEqual(report.errors,[]);
 report.status='passed';report.phase=null;
}catch(error){report.error=String(error);if(page){report.failedState=await read().catch(String);await page.screenshot({path:output+'/failure.png'}).catch(()=>{});}process.exitCode=1;}
finally{await context?.close();report.browserClosed=true;await save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:output+'/report.json'}));
