import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {serialize} from 'node:v8';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
import {fluidSourceIdentity} from '../fluid-session-browser.mjs';
import {bindFluidWorkingSession} from '../fluid-working-session.mjs';

const {values:early}=parseArgs({options:{out:{type:'string'}},strict:false});
if(!early.out)throw Error('--out is required');
const out=path.resolve(early.out);await fs.mkdir(out,{recursive:true});
const reportPath=path.join(out,'report.json');await fs.writeFile(reportPath,'',{flag:'wx'});
const report={schema:'kaminos.performance-report.v1',status:'running',phase:'arguments',
  startedAt:new Date().toISOString(),argv:process.argv.slice(2),cases:[]};
const save=()=>fs.writeFile(reportPath,JSON.stringify(report,null,2));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);assert.ok(sorted.length);
  assert.ok(sorted.every(v=>Number.isFinite(v)&&v>=0));
  return {count:sorted.length,mean:sorted.reduce((a,b)=>a+b,0)/sorted.length,
    ...Object.fromEntries([50,95,99].map(p=>[`p${p}`,sorted[Math.ceil(sorted.length*p/100)-1]]))};};
// These fields are admitted by the existing Fluid route-config API. Adding a
// saved route input requires an observed effective counterpart, not just URL forwarding.
const routeFields={
  finger_fluid_pressure_solver:['effectivePressureSolver','pressureSolver'],
  finger_fluid_particle_count:['effectiveParticleCount','particleCount',Number],
  finger_fluid_density_iterations:['effectivePressureIterations','densityIterationsPerStep',Number],
  finger_fluid_renderer:['effectiveRendererMode','effectiveRendererMode'],
  finger_fluid_optical_debug:['effectiveOpticalDebugMode','opticalDebugMode'],
  finger_fluid_truth_scene:['effectiveTruthScene'],
  finger_fluid_optical_lighting:['effectiveOpticalLightingMode','effectiveOpticalLightingMode'],
  finger_fluid_optical_footprint:['effectiveOpticalFootprintMode','effectiveOpticalFootprintMode'],
  finger_fluid_transmission_footprint:['effectiveTransmissionFootprintMode','effectiveTransmissionFootprintMode'],
  finger_fluid_body_transport:['effectiveBodyTransportMode','effectiveBodyTransportMode'],
  finger_fluid_interface_frequency:['effectiveInterfaceFrequencyMode','effectiveInterfaceFrequencyMode'],
  finger_fluid_witness_target_step:['effectiveWitnessTargetStep',null,Number],
  finger_fluid_witness_start_step:['effectiveWitnessStartStep',null,Number],
};
const entryFields={workspace:'workbench',kaminos_finger_fluid_bench:'1',finger_fluid_pressure_cockpit:'1'};
function admitRoute(route,held){
  for(const [key,value] of Object.entries(route)){
    if(key in entryFields){assert.equal(String(value),entryFields[key],`Unsupported entry ${key}`);continue;}
    const [field,runtimeField,convert=String]=routeFields[key];const requested=convert(value);
    assert.equal(held.bench.config[field],requested,`Route input ${key} did not reach effective ${field}`);
    if(runtimeField)assert.equal(held.bench.runtime[runtimeField],requested,`Runtime did not execute ${key}`);
  }
  assert.equal(held.bench.runtime.solver_backend,'webgpu_compute');
  assert.equal(held.bench.runtime.render_backend,'webgpu_direct_render');
  for(const [key,value] of Object.entries(held.bench.runtime))if(key==='fallbackReason'||key.endsWith('FallbackReason'))assert.equal(value,null,`Fallback route: ${key}`);
  return {requested:route,config:held.bench.config,runtime:Object.fromEntries(Object.entries(held.bench.runtime).filter(([key])=>/Route$|backend$|FallbackReason$|^fallbackReason$|^pressureSolver$|^particleCount$|^densityIterationsPerStep$|^effective.*Mode$|^opticalDebugMode$/.test(key)))};
}
let browser,page,server,serverLog,signalFailure;
const onSignal=signal=>{signalFailure=Error(`Caller interrupted: ${signal}`);browser?.close();server?.kill('SIGTERM');};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>onSignal(signal));
await save();
try {
  const {values:a}=parseArgs({options:{...Object.fromEntries(['out','config','repo','url','port','browser','playwright','expected-revision','fault'].map(k=>[k,{type:'string'}])), 'inspect-only':{type:'boolean'}}});
  for(const key of ['config','repo','browser','playwright'])assert.ok(a[key],`--${key} required`);
  assert.ok(Boolean(a.url)!==Boolean(a.port),'Specify one of --url or --port');
  const repo=await fs.realpath(a.repo),configBytes=await fs.readFile(a.config);
  const config=JSON.parse(configBytes);report.config=config;report.configSha256=hash(configBytes);
  assert.equal(config.schema,'kaminos.performance.v1');assert.equal(config.mode,'held-render');
  for(const key of Object.keys(config.route))assert.ok(key in routeFields||key in entryFields,`Unsupported or unconsumed route input: ${key}`);
  for(const [key,min] of [['frames',2],['rounds',1],['warmupFrames',0],['heldStep',1]])assert.ok(Number.isSafeInteger(config[key])&&config[key]>=min,`Invalid ${key}`);
  assert.ok(config.cases.length&&new Set(config.cases.map(c=>c.name)).size===config.cases.length,'Case names must be unique');
  for(const c of config.cases){assert.match(c.name,/^[a-zA-Z0-9_-]+$/);assert.equal(typeof c.waterEnabled,'boolean');assert.equal(typeof c.sceneAOEnabled,'boolean');
    for(const key of Object.keys(c))assert.ok(['name','waterEnabled','sceneAOEnabled','renderScale','fresnelCutoff','energyDiagnosticsMode','timingEnabled'].includes(key),`Unknown case input ${key}`);}
  report.revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  if(a['expected-revision']){assert.equal(report.revision,a['expected-revision']);assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),'','Benchmark source must be clean');}
  report.runnerSha256=hash(await fs.readFile(new URL(import.meta.url)));
  report.claim='Actual host callback duration and redraw cadence on one held particle state; solver does not advance; display presentation and isolated GPU duration are not measured';
  report.queue={directory:process.env.GPU_GREENROOM_DIR??null};
  let url;
  if(a.port){
    assert.ok(Number.isSafeInteger(Number(a.port))&&Number(a.port)>0&&Number(a.port)<65536,'Invalid port');
    const stores={KAMINOS_VOLUME_SETTINGS_STORE:path.join(out,'stores/settings'),KAMINOS_VOLUME_BASIN_SESSION_STORE:path.join(out,'stores/basins'),KAMINOS_VOLUME_COCKPIT_LAYOUT_STORE:path.join(out,'stores/layouts'),KAMINOS_SHARED_BASIN_STORE:'off'};
    for(const store of Object.values(stores))if(store!=='off')await fs.mkdir(store,{recursive:true});
    serverLog=await fs.open(path.join(out,'server.log'),'a');
    server=spawn('python3',['-u','serve.py',a.port,'--no-shared-basin-store'],{cwd:repo,env:{...process.env,...stores},stdio:['ignore',serverLog.fd,serverLog.fd]});
    report.server={pid:server.pid,repo,port:Number(a.port),stores};report.phase='server';await save();
    url=new URL(`http://127.0.0.1:${a.port}/index.html`);
    await new Promise((resolve,reject)=>{
      server.once('error',reject);server.once('exit',()=>reject(Error('Owned server exited before source admission')));
      const ready=async()=>{if(signalFailure)return reject(signalFailure);try{
        const response=await fetch(new URL('/api/runtime-config',url));
        if(response.ok){const state=await response.json();assert.equal(await fs.realpath(state.source.repoRoot),repo,'Port occupied by another checkout');assert.equal(state.source.commit,report.revision,'Wrong server revision');return resolve();}
      }catch(e){if(e.code==='ERR_ASSERTION')return reject(e);}setTimeout(ready,100);};ready();
    });
  }else url=new URL(a.url);
  for(const [key,value] of Object.entries(config.route))url.searchParams.set(key,String(value));
  url.searchParams.set('kaminos_performance','1');report.url=String(url);
  report.phase='source';await save();
  const sourceFiles=['performance-harness.mjs','fluid-budget-cockpit.mjs','fluid-app-frame-timing.mjs'];
  report.source=await fluidSourceIdentity(String(url),repo,{additionalFiles:sourceFiles});
  const executable=fluidBrowserLaunch({executable:a.browser,debugPort:0,userDataDir:out,...config.viewport}).executable;
  const {chromium}=await import(pathToFileURL(path.resolve(a.playwright)));
  report.phase='browser';await save();
  browser=await chromium.launch({executablePath:executable,headless:true,timeout:0,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  report.browser={executable,version:browser.version(),viewport:config.viewport};
  page=await browser.newPage({viewport:{width:config.viewport.width,height:config.viewport.height},deviceScaleFactor:config.viewport.deviceScaleFactor});
  page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  report.errors=[];report.networkFailures=[];
  let rejectFatal;const fatal=new Promise((_,reject)=>{rejectFatal=reject;});fatal.catch(()=>{});
  const fatalError=message=>{report.errors.push(message);rejectFatal(Error(message));};
  const required=url=>['.js','.mjs','.html'].some(ext=>new URL(url).pathname.endsWith(ext));
  page.on('pageerror',e=>fatalError(e.message));page.on('crash',()=>fatalError('Browser page crashed'));
  page.on('response',response=>{if(response.status()>=400&&required(response.url())){report.networkFailures.push({url:response.url(),status:response.status()});fatalError(`Required module HTTP${response.status()}: ${response.url()}`);}});
  page.on('requestfailed',request=>{if(required(request.url())){report.networkFailures.push({url:request.url(),failure:request.failure()});fatalError(`Required module request failed: ${request.url()}`);}});
  await page.addInitScript(()=>{window.__performanceErrors=[];window.addEventListener('unhandledrejection',e=>window.__performanceErrors.push(String(e.reason)));});
  if(a.fault){assert.equal(a.fault,'missing-module');report.fault=a.fault;
    await page.route('**/node_modules/three-mesh-bvh/build/index.module.js',route=>route.fulfill({status:404,body:'Recorded required-module failure replay'}));}
  report.phase='load';await save();
  const guarded=operation=>Promise.race([operation,fatal]);
  await guarded(page.goto(String(url)));
  await guarded(page.waitForFunction(()=>window.kaminosPerformance&&window.kaminosFingerFluidBenchSessionState?.().available||window.kaminosFingerFluidBenchDebugState?.().status==='error'||window.__performanceErrors.length));
  assert.deepEqual(await page.evaluate(()=>window.__performanceErrors),[]);
  const fluid=await bindFluidWorkingSession(page);
  await page.evaluate(step=>{window.kaminosFingerFluidBenchSetSimulationPausedForWitness(true);const clock=window.kaminosFingerFluidBenchSessionState();if(clock.step>step)throw Error('Requested held state already passed');if(clock.step<step)window.kaminosFingerFluidBenchAdvanceToStepForWitness(step);},config.heldStep);
  report.phase='route-admission';await save();
  report.routeAdmission=admitRoute(config.route,await fluid.hold());await fluid.view(config.camera);
  await page.evaluate(()=>{window.kaminosFingerFluidBenchResumeAfterWitness();document.querySelector('[data-reflection-control=count-rays]').checked=false;});
  let baselineHash,baselineScene,baselineSolids;
  for(let round=0;round<config.rounds;round++)for(const caseConfig of round%2?[...config.cases].reverse():config.cases){
    const ordinal=a['inspect-only']?(report.inspections?.length??0):report.cases.length,stem=`case-${ordinal}-${caseConfig.name}`;
    report.phase=stem;report.activeCase={round,name:caseConfig.name,requested:caseConfig};await save();
    const held=await fluid.hold();
    const routeAdmission=admitRoute(config.route,held);
    await fs.writeFile(path.join(out,`${stem}-start.v8`),serialize(held));
    const particleHash=hash(Buffer.from(new Uint32Array(held.bench.runtime.diagnostics.particleSnapshot.words).buffer));
    baselineHash??=particleHash;assert.equal(particleHash,baselineHash,'Held particle state changed between cases');
    const {name,...caseControls}=caseConfig,requested={...config.controls,...caseControls};
    await page.evaluate(patch=>{window.kaminosFingerFluidBenchResumeAfterWitness();window.kaminosPerformance.apply(patch);},requested);
    const before=await page.evaluate(()=>window.kaminosPerformance.read());
    assert.equal(before.controls.waterEnabled,caseConfig.waterEnabled);assert.equal(before.controls.sceneAOEnabled,caseConfig.sceneAOEnabled);
    assert.equal(before.controls.renderScale,requested.renderScale);assert.equal(before.controls.reflection.fresnelCutoff,Math.fround(requested.fresnelCutoff));
    assert.equal(before.controls.energy,requested.energyDiagnosticsMode);assert.equal(before.controls.timingEnabled,requested.timingEnabled);
    if(a['inspect-only']){
      await guarded(page.waitForFunction(water=>window.kaminosPerformance.read().render?.waterEnabled===water,caseConfig.waterEnabled));
      await page.screenshot({path:path.join(out,`${stem}.png`)});
      report.inspections??=[];report.inspections.push({name:caseConfig.name,image:`${stem}.png`,state:await page.evaluate(()=>window.kaminosPerformance.read()),scene:await page.evaluate(()=>window.kaminosPerformance.sceneSnapshot())});await save();continue;
    }
    const measured=await guarded(page.evaluate(options=>window.kaminosPerformance.sample(options),{frames:config.frames,warmupFrames:config.warmupFrames}));
    assert.equal(measured.frames.length,config.frames);assert.equal(new Set(measured.frames.map(f=>f.frameId)).size,config.frames,'Repeated or cached frame counted');
    const after=measured.state;
    const solidScene=await page.evaluate(()=>window.kaminosPerformance.sceneSnapshot());
    const solidHash=hash(JSON.stringify(solidScene));baselineSolids??=solidHash;assert.equal(solidHash,baselineSolids,'Solid geometry or visibility changed between cases');
    const scene=JSON.stringify({camera:after.camera,extent:after.extent});baselineScene??=scene;assert.equal(scene,baselineScene,'Comparison camera or extent changed');
    assert.equal(after.clock.step,config.heldStep);
    const workDelta=Object.fromEntries(Object.entries(after.aoWork).map(([k,v])=>[k,v-measured.workStart[k]]));
    assert.ok(Object.values(workDelta).every(v=>caseConfig.sceneAOEnabled?v>0:v===0),'AO execution differs from requested case');
    await page.screenshot({path:path.join(out,`${stem}.png`)});
    const endHeld=await fluid.hold();await fs.writeFile(path.join(out,`${stem}-end.v8`),serialize(endHeld));
    const endHash=hash(Buffer.from(new Uint32Array(endHeld.bench.runtime.diagnostics.particleSnapshot.words).buffer));assert.equal(endHash,baselineHash,'Water changed during measurement');
    const callbackMs=stats(measured.frames.map(f=>f.callbackMs)),intervalMs=stats(measured.frames.slice(1).map((f,i)=>f.startedAt-measured.frames[i].startedAt));
    const row={round,name:caseConfig.name,requested,effective:after,routeAdmission,particleHash,endHash,solidHash,solidScene,
      callbackMs,intervalMs,fps:1000/intervalMs.mean,workDelta,image:`${stem}.png`,rawFrames:`${stem}.json`};
    await fs.writeFile(path.join(out,row.rawFrames),JSON.stringify(measured,null,2));report.cases.push(row);await save();
  }
  assert.deepEqual(await page.evaluate(()=>window.__performanceErrors),[]);
  assert.deepEqual(await fluidSourceIdentity(String(url),repo,{additionalFiles:sourceFiles}),report.source,'Source changed during run');
  report.effects=[];
  for(let round=0;round<config.rounds;round++){
    const rows=report.cases.filter(c=>c.round===round);
    const pairs=[];
    for(const waterEnabled of [false,true]){
      const select=ao=>rows.filter(c=>c.requested.waterEnabled===waterEnabled&&c.requested.sceneAOEnabled===ao);
      const on=select(true),off=select(false);
      if(on.length!==1||off.length!==1)continue;
      const rest=c=>JSON.stringify(Object.fromEntries(Object.entries(c.requested).filter(([k])=>!['waterEnabled','sceneAOEnabled'].includes(k))));
      if(rest(on[0])!==rest(off[0]))continue;
      pairs.push({waterEnabled,controls:rest(on[0]),callbackMeanDeltaMs:on[0].callbackMs.mean-off[0].callbackMs.mean,
        drawIntervalMeanDeltaMs:on[0].intervalMs.mean-off[0].intervalMs.mean});
    }
    if(pairs.length===2&&pairs[0].controls===pairs[1].controls)report.effects.push({round,sceneAO:pairs[0],waterAO:pairs[1],
      extraAOWithWater:{callbackMeanMs:pairs[1].callbackMeanDeltaMs-pairs[0].callbackMeanDeltaMs,drawIntervalMeanMs:pairs[1].drawIntervalMeanDeltaMs-pairs[0].drawIntervalMeanDeltaMs},
      interpretation:'Descriptive differences within this round; repeated-round variation must be considered before attributing a water interaction'});
  }
  report.sameHeldState=a['inspect-only']?null:true;report.status='observed';report.phase=a['inspect-only']?'inspection-complete':'complete';delete report.activeCase;
}catch(error){report.status='failed';report.failure=String((signalFailure??error).stack||error);process.exitCode=1;
  if(page)try{report.lastTrustworthyRuntime=await page.evaluate(()=>({state:window.kaminosPerformance?.read(),progress:window.kaminosPerformance?.progress(),clock:window.kaminosFingerFluidBenchSessionState?.(),errors:window.__performanceErrors}));}catch(e){report.runtimeReadFailure=String(e);}
}finally{
  await save();
  try{await browser?.close();}catch(error){report.cleanupFailure=String(error);report.status='failed';process.exitCode=1;}
  if(server&&server.exitCode===null){const ended=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await ended;}
  await serverLog?.close();report.finishedAt=new Date().toISOString();await save();
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format=value=>Number(value).toFixed(2);
  await fs.writeFile(path.join(out,'comparison.html'),`<!doctype html><meta charset="utf-8"><title>Kaminos performance comparison</title><style>body{background:#182126;color:#d9e5e9;font:16px system-ui;margin:30px}table{border-collapse:collapse}td,th{padding:9px;border:1px solid #63747c;text-align:left}img{width:min(700px,100%)}a{color:#8ed5ff}small{display:block}</style><h1>Kaminos performance comparison</h1><p>${escape(report.status)} · ${escape(report.phase)} · ${escape(report.revision??'source unavailable')}</p><p>${escape(report.claim??report.failure)}</p><a href="report.json">Full report and effective configuration</a><table><tr><th>Round / case</th><th>Callback P50 / P95 / P99 (ms)</th><th>Draw interval P50 / P95 / P99 (ms)</th><th>Mean FPS</th></tr>${report.cases.map(c=>`<tr><td>${c.round+1} / ${escape(c.name)}</td><td>${[50,95,99].map(p=>format(c.callbackMs['p'+p])).join(' / ')}</td><td>${[50,95,99].map(p=>format(c.intervalMs['p'+p])).join(' / ')}</td><td>${format(c.fps)}</td></tr>`).join('')}</table>${report.cases.map(c=>`<h2>${escape(c.name)} · round ${c.round+1}</h2><a href="${c.image}"><img src="${c.image}"></a><small><a href="${c.rawFrames}">All frame samples</a></small>`).join('')}${report.failure?`<pre>${escape(report.failure)}</pre>`:''}`);
  if(report.inspections?.length)await fs.writeFile(path.join(out,'inspection.html'),`<!doctype html><meta charset="utf-8"><title>Performance control inspection</title><h1>Control inspection — no timing results</h1>${report.inspections.map(c=>`<h2>${escape(c.name)}</h2><img style="width:min(100%,900px)" src="${c.image}">`).join('')}`);
  await fs.writeFile(path.join(out,'terminal-signal.json'),JSON.stringify({status:report.status,phase:report.phase,report:reportPath,exitCode:process.exitCode??0}));
  console.log(JSON.stringify({out,status:report.status,phase:report.phase,cases:report.cases.map(c=>({name:c.name,round:c.round,callbackMs:c.callbackMs,intervalMs:c.intervalMs,workDelta:c.workDelta})),failure:report.failure}));
}
