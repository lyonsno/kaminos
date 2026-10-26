// Same current-field capture API used by Save basin and endpoint Capture.
// Batch execution belongs in Greenroom; --smoke exercises one ordinary browser capture.
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const out=resolve(option('--output','scratch/basin-portraits')),steps=Number(option('--steps','60')),smoke=args.includes('--smoke');
if(!Number.isInteger(steps)||steps<30)throw Error('--steps must be an integer of at least 30');
mkdirSync(out,{recursive:true});
const report={status:'running',phase:'start',root:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),steps,smoke,entries:[],errors:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();
const phase=value=>{report.phase=value;save();};
const port=Number(option('--port','8351')),debugPort=Number(option('--debug-port','9521')),origin=`http://127.0.0.1:${port}`;
const server=spawn('python3',['serve.py',String(port)],{cwd:process.cwd(),env:{...process.env,KAMINOS_BIND_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let serverLog='',browserLog='',browser,ws;server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{report.status='interrupted';save();ws?.close();browser?.kill('SIGTERM');server.kill('SIGTERM');process.exit(130);});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let nextId=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const screenshot=async name=>{const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(out+'/'+name+'.png',Buffer.from(r.data,'base64'));};
try{
 phase('server-start');let runtime;
 while(!runtime){if(server.exitCode!==null)throw Error('Server exited: '+serverLog);try{runtime=await(await fetch(origin+'/api/runtime-config')).json();}catch{await delay(100);}}
 report.runtime=runtime;
 assert.equal(runtime.source.repoRoot,report.root,'Server root differs from requested checkout');
 const launch=fluidBrowserLaunch({executable:option('--browser','/Users/noahlyons/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),debugPort,userDataDir:out+'/profile',width:1440,height:1050});report.browser=launch;
 browser=spawn(launch.executable,[...launch.args,'--headless=new','--disable-gpu-sandbox','--enable-unsafe-webgpu'],{stdio:['ignore','ignore','pipe']});browser.stderr.on('data',b=>browserLog+=b);
 let targets;while(!targets){if(browser.exitCode!==null)throw Error('Browser exited: '+browserLog);try{targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();}catch{await delay(100);}}
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const entry=pending.get(data.id);if(entry){pending.delete(data.id);data.error?entry.reject(Error(data.error.message)):entry.resolve(data.result);}}else if(data.method==='Runtime.exceptionThrown'){report.errors.push(data.params);save();}});
 await call('Runtime.enable');await call('Page.enable');report.url=origin+'/index.html?experiment=inference-flame&workspace=workbench';await call('Page.navigate',{url:report.url});phase('workbench-load');
 while(!await evaluate("window.kaminosWorkbenchExperiments?.state().id==='inference-flame'")){if(report.errors.length)throw Error('Workbench load failed: '+JSON.stringify(report.errors));const error=await evaluate("document.body.innerText.includes('Experiments unavailable:')?document.body.innerText:null");if(error)throw Error(error);await delay(150);}
 await evaluate('(async()=>{window.portraitFlame=await window.kaminosFlameWorkbench.open();return true;})()');
 const index=await evaluate('portraitFlame.listBasins()');
 const candidates=[];
 for(const entry of index.entries){const response=await fetch(origin+'/api/volume-settings-preset?id='+encodeURIComponent(entry.presetId));const body=await response.json();const preset=body.preset??body;const controls=preset.controls??preset.domControls;
  if(controls?.['volume-reaction-law']?.value==='reactant-v0')candidates.push(entry);
 }
 const requested=option('--ids',null);report.inventory=candidates;
 const chosen=requested?requested.split(',').map(id=>{const entry=candidates.find(e=>e.presetId===id);if(!entry)throw Error('Requested basin missing or not reactant-combustion: '+id);return entry;}):smoke?candidates.filter(e=>e.label==='opening-puff'):candidates;
 if(!chosen.length)throw Error('No compatible reactant-combustion basins were found');
 for(const entry of chosen){const item={presetId:entry.presetId,label:entry.label,status:'running'};report.entries.push(item);phase('basin-load');
  try{
   await evaluate(`portraitFlame.applyBasin(${JSON.stringify(entry.presetId)})`);
   phase('field-warm');
   item.application=await evaluate('({clamps:window.__kaminosFlameBasinClampReport,source:portraitFlame.settings().source})');
   item.warm=await evaluate(`(async()=>{const p=window.__kaminosVolumePrototype;while(!p?.debugState().active)await new Promise(r=>setTimeout(r,50));const start=p.debugState().simStepCount;const r=await p.pauseSelectiveHeadLiveAtSimStep(start+${steps});if(!r.ok)throw Error(JSON.stringify(r));return {start,requestedSteps:${steps},receipt:r,settings:portraitFlame.settings(),runtime:p.debugState()};})()`);
   phase('portrait-capture');
   const capture=await evaluate(`(async()=>{const before=portraitFlame.read().view,settings=portraitFlame.settings(),p=await portraitFlame.capturePortrait({origin:${JSON.stringify(smoke?'current-field':'backfill')}}),after=portraitFlame.read().view;if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Capture changed the operator camera');if(JSON.stringify(settings)!==JSON.stringify(portraitFlame.settings()))throw Error('Capture changed settings');return p;})()`);
   capture.basinApplication={presetId:entry.presetId,clamps:item.application.clamps,projection:item.application.source?.serverProjection,appearanceModel:item.warm.runtime.appearanceModel};
   item.portrait=capture;writeFileSync(out+'/'+entry.presetId+'.png',Buffer.from(capture.image.split(',')[1],'base64'));
   if(smoke){
    phase('endpoint-library-exercise');
    item.ui=await evaluate(`(async()=>{const w=window.kaminosWorkbenchExperiments;await w.invoke('capture','a');await w.invoke('capture','b');await w.invoke('response.saveBlendObject',{kind:'ramp',label:'Portrait smoke'});const before=await w.invoke('response.export');await w.invoke('capture','a');await w.invoke('response.restore',before);const s=await w.read();await Promise.all([...document.querySelectorAll('.flame-blend-endpoint img,.object-portraits img')].map(i=>i.decode()));return {images:[...document.querySelectorAll('.flame-blend-endpoint img,.object-portraits img')].map(i=>({src:i.src,complete:i.complete,width:i.naturalWidth})),portable:before.score.objects.every(o=>[o.recipe.a,o.recipe.b].every(e=>e.portrait?.image?.startsWith('data:image/png;'))),sourceHasPixels:JSON.stringify(s.blend?.a?.settings??{}).includes('data:image')};})()`);
    assert.equal(item.ui.portable,true);assert.equal(item.ui.sourceHasPixels,false);assert.equal(item.ui.images.length,4);assert.ok(item.ui.images.every(image=>image.complete&&image.width===256));await evaluate("document.querySelector('.object-card').scrollIntoView({block:'center'})");await screenshot('portrait-library');await evaluate("document.querySelector('.flame-blend-cockpit').closest('details').open=true;document.querySelector('.flame-blend-endpoint').scrollIntoView({block:'start'})");await screenshot('portrait-endpoints');
   }else{
    phase('cover-publish');const response=await fetch(origin+'/api/volume-settings-preset-cover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({presetId:entry.presetId,portrait:capture})});const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error||'Cover write failed');item.cover=body.cover;
   }
   item.status='passed';
  }catch(error){item.status='failed';item.error=String(error.stack||error);}
  finally{await evaluate('window.__kaminosVolumePrototype?.setSelectiveHeadLiveCapturePaused(false)').catch(()=>{});save();}
 }
 if(!smoke){await evaluate("portraitFlame.select('domain');document.getElementById('flame-basin-browser').open=true;document.getElementById('flame-basin-refresh').click()");await delay(300);await screenshot('basin-library');}
 report.status=report.entries.every(entry=>entry.status==='passed')?'passed':'partial';phase('complete');if(report.status!=='passed')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error.stack||error);if(ws?.readyState===WebSocket.OPEN)await screenshot('failure').catch(()=>{});process.exitCode=1;}
finally{report.serverLog=serverLog;report.browserLog=browserLog;save();ws?.close();browser?.kill('SIGTERM');server.kill('SIGTERM');console.log(JSON.stringify({status:report.status,phase:report.phase,report:out+'/report.json'}));}
