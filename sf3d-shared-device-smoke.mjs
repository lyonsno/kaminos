// Native Chrome/Metal witness. Uses the same browser route as the prior SF3D
// witness, but judges serviced ordinary frames and registered output, not rAF.
// Required: --url --scene-file --out --puppeteer --owner, plus either
// --greenroom-worker or --greenroom for an external lease. All output is caller-owned.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {applySf3dPersistenceResult, judgeSf3dSmoke} from './sf3d-host-device.mjs';
import {verifyAuthoringServer} from './scene-authoring-witness-identity.mjs';
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name)+1];
for (const flag of ['--url','--scene-file','--out','--puppeteer','--owner']) if (!args.includes(flag)) throw new Error(`required ${flag}`);
const workerSupervised = args.includes('--greenroom-worker');
if (!workerSupervised && !args.includes('--greenroom')) throw new Error('required --greenroom or --greenroom-worker');
const out = path.resolve(arg('--out'));
fs.mkdirSync(out,{recursive:true});
const report = {schema:'kaminos.sf3d-shared-device-smoke.v0',ok:false,phase:'startup',requestedUrl:arg('--url'),cwd:process.cwd(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),events:[],samples:[]};
const save = () => fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const greenroom = (...argv) => JSON.parse(execFileSync(arg('--greenroom'),argv,{encoding:'utf8'}));
let browser, page, lease, renewal, sampling;
save();
try {
  report.phase='serving-identity';save();
  report.serving=await verifyAuthoringServer({origin:new URL(arg('--url')).origin,repoRoot:process.cwd()});
  report.phase='scene-source';save();
  const requestedScene = arg('--scene-file');
  const entryUrl = new URL(arg('--url'));
  if (new URLSearchParams(entryUrl.hash.slice(1)).get('scene') !== requestedScene) throw new Error('entry route does not name the requested scene');
  const sceneResponse = await fetch(new URL(`/api/read?${new URLSearchParams({root:'scenes',path:requestedScene})}`,entryUrl.origin),{cache:'no-store'});
  if (!sceneResponse.ok) throw new Error(`requested scene HTTP ${sceneResponse.status}`);
  const sceneDocument = await sceneResponse.json();
  const presetId = sceneDocument.composition?.flame?.presetId;
  const modelSource = sceneDocument.model?.source;
  const routePresetId = entryUrl.searchParams.get('settings_preset') || entryUrl.searchParams.get('preset');
  if (!presetId || !modelSource || routePresetId !== presetId) throw new Error('scene, model, and basin route identity do not agree');
  report.expectedScene={file:requestedScene,presetId,modelSource,label:sceneDocument.label};save();
  if (workerSupervised) {
    report.phase='worker-supervision';save();
    const parentCommand=execFileSync('ps',['-p',String(process.ppid),'-o','command='],{encoding:'utf8'}).trim();
    report.supervision={kind:'greenroom-worker',parentPid:process.ppid,parentCommand};save();
    if (!/gpu_queue\.cli worker/.test(parentCommand)) throw new Error('greenroom-worker mode requires a live Greenroom worker parent');
  } else {
    report.phase='lease-claim';save();
    lease = greenroom('lease','claim','--owner',arg('--owner'),'--agent-id','sf3d-shared-device-smoke','--repo-root',process.cwd(),'--pid',String(process.pid),'--effective-route',`${arg('--url')} Chrome native Metal ordinary flame + SF3D shared device`,'--backend','webgpu','--device','apple-gpu','--profile','browser-smoke','--supports-checkpoints','--ttl-seconds','300');
    report.lease=lease;save();
    renewal=setInterval(()=>{
      try {greenroom('lease','renew',lease.lease_id);}
      catch(error){report.events.push({at:Date.now(),kind:'lease-renew-failed',error:String(error)});save();void browser?.close();}
    },100000);
  }
  const {default:puppeteer}=await import(pathToFileURL(path.resolve(arg('--puppeteer'))));
  report.phase='browser-launch';save();
  browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,protocolTimeout:0,
    args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--no-first-run','--no-default-browser-check','--window-size=1400,1000']});
  page=await browser.newPage();await page.setViewport({width:1400,height:1000});
  page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  page.on('requestfailed',request=>{report.events.push({at:Date.now(),kind:'request-failed',url:request.url(),failure:request.failure()?.errorText||null});save();});
  page.on('response',response=>{if(response.url().includes('/lib/sf3d/weights.bin')){report.weightsResponse={status:response.status(),headers:response.headers()};save();}});
  page.on('requestfinished',request=>{if(request.url().includes('/lib/sf3d/weights.bin')){report.weightsRequestFinishedAt=Date.now();save();}});
  page.on('pageerror',e=>{report.events.push({at:Date.now(),kind:'pageerror',message:e.message});save();});
  page.on('console',m=>{if(m.type()==='error'){report.events.push({at:Date.now(),kind:'console-error',message:m.text()});save();}});
  page.on('error',e=>{report.events.push({at:Date.now(),kind:'page-crash',message:e.message});save();void browser.close();});
  page.on('close',()=>{report.events.push({at:Date.now(),kind:'page-closed'});save();});
  browser.on('disconnected',()=>{report.events.push({at:Date.now(),kind:'browser-disconnected'});save();});
  report.phase='page-load';save();
  await page.goto(arg('--url'),{waitUntil:'domcontentloaded'});
  report.phase='composition-mount';save();
  await page.waitForFunction(()=>window.__sf3dLiveFlameReady || window.__sf3dLiveFlame?.lastError || window.__kaminosCompositionSetup?.status==='failed');
  report.preflight=await page.evaluate(()=>({url:location.href,route:window.__compositionRoute,setup:window.__kaminosCompositionSetup,error:window.__sf3dLiveFlame?.lastError,preset:window.__kaminosVolumeSettingsPresetReceipt,
    producer:window.__sf3dProducer?{backend:window.__sf3dProducer.backend,deviceInjected:window.__sf3dProducer.deviceInjected}:null,
    actualSameDevice:window.__sf3dProducer?.device===window.__kaminosVolumePrototype?.foregroundGpuContext?.().device,
    flame:window.__kaminosVolumePrototype?.debugState()}));
  save();
  if(report.preflight.error || report.preflight.setup?.status==='failed') throw new Error(`mount failed: ${JSON.stringify(report.preflight)}`);
  if(!report.preflight.actualSameDevice || report.preflight.route?.renderer!=='ordinary-volume' || report.preflight.route?.foregroundScheduling!=='producer-foreground-opportunities') throw new Error('pre-inference route/device reminder fired');
  report.phase='scene-restore';save();
  await page.evaluate(async expected=>{
    const response=await fetch(`/api/read?${new URLSearchParams({root:'scenes',path:expected.file})}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`authored scene HTTP ${response.status}`);
    const file=new File([await response.text()],expected.file,{type:'application/json'});
    const transfer=new DataTransfer();transfer.items.add(file);
    const input=document.getElementById('scene-file-input');
    if(!input)throw new Error('Kaminos scene-file input unavailable');
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  },report.expectedScene);
  await page.waitForFunction(expected=>{
    const status=document.getElementById('info-bar')?.textContent||'';
    return /^Scene (?:load failed:|loaded:)|^Invalid scene/i.test(status);
  },{},report.expectedScene);
  report.sceneEvidence=await page.evaluate(()=>({
    routeSceneFile:new URLSearchParams(location.hash.slice(1)).get('scene'),
    runtimePresetId:window.__kaminosVolumeSettingsPresetReceipt?.presetId||null,
    runtimeModelSources:window.kaminosSceneObjectDebugState?.().map(row=>row.source)||[],
    runtimeStatus:document.getElementById('info-bar')?.textContent||null,
  }));save();
  const scene=report.sceneEvidence;
  if(scene.routeSceneFile!==report.expectedScene.file||scene.runtimePresetId!==report.expectedScene.presetId||
      !scene.runtimeModelSources.includes(report.expectedScene.modelSource)||!/^Scene loaded:/i.test(scene.runtimeStatus||'')) {
    throw new Error(`authored scene preflight failed: ${JSON.stringify(scene)}`);
  }
  await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().ordinaryForeground?.completedFrames >= 3 || !!window.__kaminosVolumePrototype.debugState().error);
  const flame = await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
  if(flame.error || !flame.active) throw new Error(`flame preflight failed: ${flame.error}`);
  await new Promise(resolve=>setTimeout(resolve,8000));
  await page.screenshot({path:path.join(out,'before.png')});
  report.phase='inference';save();
  let sampleBusy=false;
  sampling=setInterval(async()=>{if(sampleBusy)return;sampleBusy=true;try{
    report.samples.push(await page.evaluate(()=>({at:performance.now(),infer:document.getElementById('sf3d-infer')?.textContent,flame:window.__kaminosVolumePrototype?.debugState(),foregroundCount:window.__sf3dLiveFlame?.foregroundFrames.length})));save();
  }catch(error){report.events.push({kind:'sample-error',message:String(error)});save();}finally{sampleBusy=false;}},2000);
  await page.click('#sf3d-run');
  await page.waitForFunction(()=>window.__sf3dLiveFlame.lastResult || window.__sf3dLiveFlame.lastError);
  report.phase='output-capture';save();
  report.output=await page.evaluate(()=>{const state=window.__sf3dLiveFlame;const result=state.lastResult||state.pendingOutput;return {error:state.lastError,result:result?{...result,glb:undefined}:null};});
  if(report.output.result)report.output.result.sceneEvidence=report.sceneEvidence;
  // Preserve bytes even on a host-presentation failure: no inference rerun needed.
  const bytes=await page.evaluate(()=>{const state=window.__sf3dLiveFlame;const glb=(state.lastResult||state.pendingOutput)?.glb;return glb?Array.from(new Uint8Array(glb)):null;});
  if(bytes)fs.writeFileSync(path.join(out,'generated.glb'),Buffer.from(bytes));
  await page.screenshot({path:path.join(out,'after.png')});
  report.errors=judgeSf3dSmoke(report.output.result,{expectedScene:report.expectedScene});
  if(report.output.error)report.errors.push(JSON.stringify(report.output.error));
  if(report.events.some(row=>row.kind==='pageerror'||row.kind==='page-crash'||row.kind==='lease-renew-failed'))report.errors.push('runtime error events');
  report.ok=report.errors.length===0;report.phase='terminal';save();
  if(!report.ok)process.exitCode=1;
}catch(error){report.error={message:error.message,stack:error.stack};report.failurePhase=report.phase;process.exitCode=1;save();
  if(page&&!page.isClosed())try{report.pageAtFailure=await page.evaluate(()=>({url:location.href,readyState:document.readyState,
    compositionSetup:window.__kaminosCompositionSetup||null,flameReady:window.__sf3dLiveFlameReady||false,
    flameError:window.__sf3dLiveFlame?.lastError||null,volumeBackend:document.getElementById('volume-backend')?.textContent||null}));}catch(pageError){report.pageAtFailureError=String(pageError);}
  save();
  if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
}finally{
  clearInterval(sampling);clearInterval(renewal);
  let closed=!browser;
  if(browser)try{await browser.close();closed=true;}catch(error){report.closeError=String(error);}
  if(lease&&closed)try{report.release=greenroom('lease','release',lease.lease_id,'--released-by',arg('--owner'),'--reason','owned smoke browser closed');}catch(error){report.releaseError=String(error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();
}

report.inferenceOk=report.ok;
if(report.inferenceOk && process.exitCode !== 1){
  const persistenceOut=path.join(out,'save-reopen');
  const persistenceReport=path.join(persistenceOut,'report.json');
  report.ok=false;
  report.persistence={status:'running',report:persistenceReport};save();
  const witness=path.join(path.dirname(fileURLToPath(import.meta.url)),'sf3d-kiln-save-reopen-witness.mjs');
  const persistence=spawnSync(process.execPath,[witness,'--url',arg('--url'),'--out',persistenceOut,
    '--puppeteer',arg('--puppeteer'),'--inference-report',path.join(out,'report.json')],
  {cwd:process.cwd(),stdio:'inherit'});
  applySf3dPersistenceResult(report,{status:persistence.status,report:persistenceReport,
    error:persistence.error?.message||null});
  if(persistence.status!==0)process.exitCode=persistence.status||1;
  save();
}

console.log(JSON.stringify({ok:report.ok,integrationOk:report.integrationOk??null,phase:report.phase,
  error:report.error,persistence:report.persistence||null,report:path.join(out,'report.json'),released:report.release},null,2));
