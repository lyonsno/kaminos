import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {pathToFileURL} from 'node:url';

const [root,sourceReport,store,out]=process.argv.slice(2);
const raySteps=Number(process.env.DISPLAY_RAY_STEPS??8);
const renderScale=Number(process.env.DISPLAY_RENDER_SCALE??.4);
const report={ok:false,phase:'source',root,sourceReport,store,arms:[],errors:[],warnings:[],claim:'native display reconstruction comparison; no performance claim'};
await fs.mkdir(out,{recursive:true});
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
let context,page,server;
try {
  await save();
  report.head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const prior=JSON.parse(await fs.readFile(sourceReport));
  const priorUrl=new URL(prior.offer);
  const sceneName=new URLSearchParams(priorUrl.hash.slice(1)).get('scene');
  assert.ok(sceneName&&!sceneName.includes('/'),'named source scene required');
  const sceneBytes=await fs.readFile(store+'/scenes/'+sceneName);
  await fs.writeFile(out+'/source-scene.json',sceneBytes);
  const scene=JSON.parse(sceneBytes);
  report.fixtureChanges=[];
  for(const object of scene.objects??[])for(const id of ['volume-render-detail','volume-render-detail-scale','volume-render-detail-fine']) {
    if(Object.hasOwn(object.volumeMaterial?.settings??{},id)) {
      report.fixtureChanges.push({object:object.id,id,previous:object.volumeMaterial.settings[id],reason:'parked displacement control absent from current main'});
      delete object.volumeMaterial.settings[id];
    }
  }
  await fs.mkdir(out+'/scenes',{recursive:true});
  await fs.writeFile(out+'/scenes/'+sceneName,JSON.stringify(scene,null,2));
  report.sourceFiles=[];
  const changed=execFileSync('git',['diff','--name-only','HEAD','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  report.sourceDiff=execFileSync('git',['diff','--binary','HEAD'],{cwd:root,encoding:'utf8'});
  for(const file of new Set([...changed,...untracked])) {
    if(!await fs.stat(root+'/'+file).catch(()=>null)){report.sourceFiles.push({file,deleted:true});continue;}
    const bytes=await fs.readFile(root+'/'+file);
    await fs.mkdir(out+'/source/'+file.slice(0,file.lastIndexOf('/')+1),{recursive:true});
    await fs.writeFile(out+'/source/'+file,bytes);
    report.sourceFiles.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const portProbe=net.createServer();portProbe.listen(0,'127.0.0.1');await once(portProbe,'listening');
  const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
  report.origin='http://127.0.0.1:'+port;
  server=spawn('python3',['serve.py',String(port)],{cwd:root,env:{...process.env,
    KAMINOS_VOLUME_SETTINGS_STORE:store+'/basins',KAMINOS_SCENES_DIR:out+'/scenes',
    KAMINOS_SHARED_BASIN_STORE:process.env.HOME+'/.local/share/kaminos/basins',
    KAMINOS_VOLUME_COCKPIT_LAYOUT_STORE:out+'/layouts'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',s=>{void fs.appendFile(out+'/server.log',s);});
  server.stderr.on('data',s=>{void fs.appendFile(out+'/server.log',s);});
  for(;;){if(server.exitCode!==null)throw Error('Owned server exited: '+server.exitCode);
    try{await fetch(report.origin+'/api/runtime-config');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  const {verifyAuthoringServer}=await import(pathToFileURL(root+'/scene-authoring-witness-identity.mjs'));
  report.serving=await verifyAuthoringServer({origin:report.origin,repoRoot:root});
  const url=new URL(prior.offer);url.host=new URL(report.origin).host;report.url=url.href;
  report.executable=process.env.CHROMIUM_EXECUTABLE;
  assert.ok(report.executable?.includes('Google Chrome for Testing'),'Independent browser required');
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
  context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,
    args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--remote-debugging-port=0'],viewport:{width:1100,height:820}});
  page=context.pages()[0];page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  let rejectFatal;const fatal=new Promise((_,reject)=>{rejectFatal=reject;});fatal.catch(()=>{});
  const step=p=>Promise.race([p,fatal]);
  process.once('SIGTERM',()=>rejectFatal(Error('Owned native witness cancelled')));
  page.on('pageerror',e=>{report.errors.push(e.message);void save();rejectFatal(e);});
  page.on('console',m=>{if(['error','warning'].includes(m.type())){report.warnings.push(m.text());void save();
    if(/invalid shader|error while|validation|device lost|error occurred|PRESET LOAD FAILED/i.test(m.text()))rejectFatal(Error(m.text()));}});
  report.phase='load';await save();await step(page.goto(report.url,{waitUntil:'domcontentloaded'}));
  await step(page.waitForFunction(()=>document.getElementById('volume-display-reconstruction')&&document.readyState!=='loading'));
  report.loaded=await page.evaluate(()=>({url:location.href,experiment:window.kaminosWorkbenchExperiments?.state(),runtime:window.__kaminosVolumePrototype?.debugState(),info:document.getElementById('info-bar')?.textContent}));await save();
  await page.screenshot({path:out+'/loaded.png'});
  await step(page.waitForFunction(()=>window.kaminosWorkbenchExperimentError||window.__kaminosVolumePrototype?.debugState().error||
    (window.kaminosWorkbenchExperiments?.state().id==='flame'&&window.__kaminosVolumePrototype?.debugState().active)));
  const initializationError=await page.evaluate(()=>window.kaminosWorkbenchExperimentError||window.__kaminosVolumePrototype?.debugState().error);
  assert.ok(!initializationError,String(initializationError));
  const invoke=(op,input)=>step(page.evaluate(({op,input})=>{document.activeElement?.blur();return window.kaminosWorkbenchExperiments.invoke(op,input);},{op,input}));
  await invoke('setPaused',true);await invoke('select','domain');
  if(process.env.DISPLAY_BASIN)report.basin=await invoke('applyBasin',process.env.DISPLAY_BASIN);
  report.requested={basin:process.env.DISPLAY_BASIN??null,raySteps,renderScale};
  await invoke('setControls',{'volume-resolution':'32','volume-render-scale':renderScale,'volume-steps':raySteps,
    'volume-ray-noise-animated':false,'volume-flame-priority':0,'volume-display-reconstruction':'off'});
  report.initial=await page.evaluate(()=>({runtime:window.__kaminosVolumePrototype.debugState(),water:window.kaminosLocalLiquidState()}));
  assert.equal(report.initial.runtime.backend,'WebGPU:apple');assert.equal(report.initial.water.mounted,false);
  report.phase='evolve';await save();await invoke('setPaused',false);
  await step(page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=60));
  await invoke('setPaused',true);
  const capture=async(label,mode,emission=.5,smoke=.5,scale='2')=>{
    report.phase=label;await save();
    await invoke('setControls',{'volume-display-reconstruction':mode,'volume-display-grid-scale':scale,
      'volume-emission-smoothing':emission,'volume-smoke-smoothing':smoke});
    const a=await step(page.evaluate(async()=>{
      const r=window.__kaminosVolumePrototype;const frame=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
      if(!frame.ok||frame.simAdvanced||!frame.image||frame.image.rgba.length!==frame.image.width*frame.image.height*4)throw Error('Missing held native RGBA');
      const canvas=document.createElement('canvas');canvas.width=frame.image.width;canvas.height=frame.image.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.image.rgba),canvas.width,canvas.height),0,0);
      return {state:r.debugState(),width:canvas.width,height:canvas.height,rgba:frame.image.rgba,png:canvas.toDataURL().split(',')[1]};
    }));
    const pixels=Buffer.from(a.rgba);await fs.writeFile(out+'/'+label+'.rgba',pixels);
    await fs.writeFile(out+'/'+label+'.png',Buffer.from(a.png,'base64'));
    delete a.png;delete a.rgba;
    const row={label,...a,sha256:createHash('sha256').update(pixels).digest('hex')};report.arms.push(row);await save();
    assert.equal(row.state.displayReconstruction.requested,mode);
    assert.equal(row.state.backend,'WebGPU:apple');
    assert.equal(row.state.effectiveRoute,'native-3d-compute-fluid-raymarch-v0');
    assert.equal(row.state.productFrameOwner,'prototype');
    assert.equal(row.state.displayReconstruction.effective,mode!=='off',row.state.displayReconstruction.reason);
    assert.equal(row.state.controls.resolution,32);assert.equal(row.state.controls.raySteps,raySteps);
    assert.ok(new Set(pixels).size>8,'nonblank image');
    if(mode!=='off')assert.deepEqual(row.state.displayReconstruction.grid,row.state.simGridDimensions.map(n=>n*Number(scale)));
    return row;
  };
  const baseline=await capture('native','off');
  for(const mode of ['material','optical']) {
    await capture(mode+'-linear',mode,0,0);
    await capture(mode+'-emission',mode,1,0);
    await capture(mode+'-smoke',mode,0,1);
    const first=await capture(mode+'-both',mode);
    const repeat=await capture(mode+'-held',mode);
    assert.equal(first.sha256,repeat.sha256,'held pixels stable');
    assert.equal(first.state.displayReconstruction.builds,repeat.state.displayReconstruction.builds,'held preparation cached');
  }
  const returned=await capture('native-return','off');
  assert.equal(baseline.sha256,returned.sha256,'off restores exact baseline');
  assert.ok(report.arms.every(a=>a.state.simStepCount===baseline.state.simStepCount),'same simulation source across all arms');
  assert.notEqual(report.arms.find(a=>a.label==='material-both').sha256,baseline.sha256,'candidate not ignored');
  if(process.env.DISPLAY_PROFILE==='1') {
    report.phase='gpu-profile';report.profiles=[];await save();
    await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
    // Seven interleaved samples expose cold setup separately and retain every
    // measurement. The unchanged held field isolates preparation from solving.
    for(let repeat=0;repeat<7;repeat++)for(const mode of ['off','material','optical']) {
      await invoke('setControls',{'volume-display-reconstruction':mode,
        'volume-display-grid-scale':'2','volume-emission-smoothing':.5,'volume-smoke-smoothing':.5});
      const timing=await step(page.evaluate(()=>window.__kaminosVolumePrototype.sampleEmissiveRaymarchProfile({now:4000,includeDisplayPreparation:true})));
      report.profiles.push({repeat,mode,...timing});await save();
      assert.equal(timing.ok,true,timing.reason);
      assert.equal(timing.simStepCount,baseline.state.simStepCount);
      assert.equal(timing.displayReconstruction.effective,mode!=='off');
      if(mode!=='off')assert.ok(timing.displayPreparationMs>0&&timing.preparationAndCameraSpanMs>=Math.max(timing.ms,timing.displayPreparationMs));
    }
    await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(false));
  }
  await capture('offer-material','material',.5,.25);
  await page.locator('#flame-view-look').click();await page.locator('#selected-volume-display-reconstruction').scrollIntoViewIfNeeded();
  await page.screenshot({path:out+'/workbench.png'});
  await invoke('setPaused',false);
  for(let i=0;i<8;i++) {
    await step(page.waitForFunction(n=>window.__kaminosVolumePrototype.debugState().simStepCount>=n,baseline.state.simStepCount+(i+1)*3));
    await page.screenshot({path:out+'/motion-'+i+'.png'});
  }
  await invoke('setPaused',true);
  report.final=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
  assert.ok(report.final.simStepCount>baseline.state.simStepCount);
  assert.deepEqual(report.errors,[]);report.ok=true;report.phase='complete';
}catch(error){report.error=String(error.stack);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally {
  await context?.close();
  if(server&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}
  await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,out}));
}
