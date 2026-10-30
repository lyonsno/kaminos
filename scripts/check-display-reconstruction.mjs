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
const interpolationComparison=process.env.DISPLAY_INTERPOLATION==='1';
const localCubicComparison=process.env.DISPLAY_LOCAL_CUBIC==='1';
const blendComparison=process.env.DISPLAY_BLEND_SWEEP==='1';
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
  if(localCubicComparison) {
    report.phase='gpu-axis-conformance';await save();
    report.axisConformance=await step(page.evaluate(async()=>{
      const {checkDisplayAxes}=await import('/scripts/display-axis-conformance.mjs');
      return checkDisplayAxes();
    }));await save();
  }
  if(process.env.DISPLAY_BASIN)report.basin=await invoke('applyBasin',process.env.DISPLAY_BASIN);
  report.requested={basin:process.env.DISPLAY_BASIN??null,raySteps,renderScale};
  await invoke('setControls',{'volume-resolution':'32','volume-render-scale':renderScale,'volume-steps':raySteps,
    'volume-ray-noise-animated':false,'volume-flame-priority':0,'volume-display-reconstruction':'off'});
  if(interpolationComparison||localCubicComparison||blendComparison)await invoke('setControls',{'volume-raymarch-mode':'fixed'});
  report.initial=await page.evaluate(()=>({runtime:window.__kaminosVolumePrototype.debugState(),water:window.kaminosLocalLiquidState()}));
  assert.equal(report.initial.runtime.backend,'WebGPU:apple');assert.equal(report.initial.water.mounted,false);
  report.phase='evolve';await save();await invoke('setPaused',false);
  await step(page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=60));
  await invoke('setPaused',true);
  const capture=async(label,mode,emission=.5,smoke=.5,scale='2',alignment='cell-centred',emissionKernel='positive',smokeKernel='positive')=>{
    report.phase=label;await save();
    await invoke('setControls',{'volume-display-reconstruction':mode,'volume-display-grid-scale':scale,
      'volume-emission-smoothing':emission,'volume-smoke-smoothing':smoke,
      'volume-display-alignment':alignment,'volume-emission-interpolation':emissionKernel,'volume-smoke-interpolation':smokeKernel});
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
    assert.equal(row.state.displayReconstruction.alignment,alignment);
    assert.equal(row.state.displayReconstruction.emissionInterpolation,emissionKernel);
    assert.equal(row.state.displayReconstruction.smokeInterpolation,smokeKernel);
    assert.equal(row.state.displayReconstruction.emission,emission);
    assert.equal(row.state.displayReconstruction.smoke,smoke);
    assert.equal(row.state.displayReconstruction.scale,Number(scale));
    if(mode!=='off')assert.deepEqual(row.state.displayReconstruction.grid,row.state.simGridDimensions.map(n=>alignment==='aligned'?(n-1)*Number(scale)+1:n*Number(scale)));
    return row;
  };
  const baseline=await capture('native','off');
  if(blendComparison) {
    for(const scale of ['2','4']) {
      const first=await capture('blend-'+scale+'-0','material',0,.657,scale,'aligned','monotone','monotone');
      await capture('blend-'+scale+'-half','material',.5,.657,scale,'aligned','monotone','monotone');
      await capture('blend-'+scale+'-full','material',1,.657,scale,'aligned','monotone','monotone');
      await capture('spline-'+scale+'-full','material',1,.657,scale,'aligned','interpolating','monotone');
      const zero=await capture('spline-'+scale+'-0','material',0,.657,scale,'aligned','interpolating','monotone');
      assert.equal(first.sha256,zero.sha256,'zero blend is kernel-independent');
      const returned=await capture('blend-'+scale+'-returned','material',0,.657,scale,'aligned','monotone','monotone');
      const held=await capture('blend-'+scale+'-held','material',0,.657,scale,'aligned','monotone','monotone');
      assert.equal(first.sha256,returned.sha256,'zero blend restores exact held frame');
      assert.equal(returned.sha256,held.sha256,'unchanged held frame repeats');
      assert.equal(returned.state.displayReconstruction.builds,held.state.displayReconstruction.builds,'held preparation reused');
    }
  } else if(localCubicComparison) {
    await capture('spline-mixed','material',.5,.5,'2','aligned','interpolating','positive');
    const first=await capture('local-mixed','material',.5,.5,'2','aligned','monotone','positive');
    const repeat=await capture('local-held','material',.5,.5,'2','aligned','monotone','positive');
    assert.equal(first.sha256,repeat.sha256,'local cubic held pixels stable');
    assert.equal(first.state.displayReconstruction.builds,repeat.state.displayReconstruction.builds);
    await capture('spline-full','material',1,.5,'2','aligned','interpolating','positive');
    await capture('local-full','material',1,.5,'2','aligned','monotone','positive');
    await capture('local-smoke-spline','material',1,.5,'2','aligned','monotone','interpolating');
    await capture('spline-smoke-local','material',.5,1,'2','aligned','interpolating','monotone');
    await capture('local-both','material',1,1,'2','aligned','monotone','monotone');
    await capture('local-optical','optical',1,.5,'2','aligned','monotone','positive');
  } else if(interpolationComparison) {
    await capture('legacy-2-linear','material',0,0);
    await capture('aligned-2-linear','material',0,0,'2','aligned');
    await capture('aligned-2-emission','material',1,0,'2','aligned','interpolating');
    await capture('aligned-2-mixed','material',1,1,'2','aligned','interpolating');
    const first=await capture('aligned-2-both','material',1,1,'2','aligned','interpolating','interpolating');
    const held=await capture('aligned-2-held','material',1,1,'2','aligned','interpolating','interpolating');
    assert.equal(first.sha256,held.sha256,'interpolating held pixels stable');
    assert.equal(first.state.displayReconstruction.builds,held.state.displayReconstruction.builds);
    await capture('legacy-4-linear','material',0,0,'4');
    await capture('aligned-4-linear','material',0,0,'4','aligned');
    await capture('aligned-4-both','material',1,1,'4','aligned','interpolating','interpolating');
    await capture('optical-2-both','optical',1,1,'2','aligned','interpolating','interpolating');
  } else for(const mode of ['material','optical']) {
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
  assert.notEqual(report.arms.find(a=>a.label===(blendComparison?'blend-2-full':localCubicComparison?'local-mixed':interpolationComparison?'aligned-2-both':'material-both')).sha256,baseline.sha256,'candidate not ignored');
  if(process.env.DISPLAY_PROFILE==='1') {
    report.phase='gpu-profile';report.profiles=[];await save();
    await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
    // Seven interleaved samples expose cold setup separately and retain every
    // measurement. The unchanged held field isolates preparation from solving.
    const profileArms=localCubicComparison?[
      {mode:'off',alignment:'aligned',kernel:'monotone',smokeKernel:'positive',scale:'2',amount:.5},
      {mode:'material',alignment:'aligned',kernel:'positive',smokeKernel:'positive',scale:'2',amount:.5},
      {mode:'material',alignment:'aligned',kernel:'interpolating',smokeKernel:'positive',scale:'2',amount:.5},
      {mode:'material',alignment:'aligned',kernel:'monotone',smokeKernel:'positive',scale:'2',amount:.5},
    ]:interpolationComparison?[
      {mode:'off',alignment:'aligned',kernel:'interpolating',scale:'2',amount:1},
      {mode:'material',alignment:'cell-centred',kernel:'positive',scale:'4',amount:0},
      {mode:'material',alignment:'aligned',kernel:'positive',scale:'2',amount:0},
      {mode:'material',alignment:'aligned',kernel:'interpolating',scale:'2',amount:1},
      {mode:'material',alignment:'aligned',kernel:'interpolating',scale:'4',amount:1},
    ]:['off','material','optical'].map(mode=>({mode,alignment:'cell-centred',kernel:'positive',scale:'2',amount:.5}));
    for(let repeat=0;repeat<7;repeat++)for(const arm of profileArms) {
      const {mode,alignment,kernel,scale,amount,smokeKernel=kernel}=arm;
      await invoke('setControls',{'volume-display-reconstruction':mode,
        'volume-display-grid-scale':scale,'volume-emission-smoothing':amount,'volume-smoke-smoothing':amount,
        'volume-display-alignment':alignment,'volume-emission-interpolation':kernel,'volume-smoke-interpolation':smokeKernel});
      const timing=await step(page.evaluate(()=>window.__kaminosVolumePrototype.sampleEmissiveRaymarchProfile({now:4000,includeDisplayPreparation:true})));
      report.profiles.push({repeat,arm,...timing});await save();
      assert.equal(timing.ok,true,timing.reason);
      assert.equal(timing.simStepCount,baseline.state.simStepCount);
      assert.equal(timing.displayReconstruction.effective,mode!=='off');
      assert.equal(timing.displayReconstruction.emissionInterpolation,kernel);
      assert.equal(timing.displayReconstruction.smokeInterpolation,smokeKernel);
      if(mode!=='off')assert.ok(timing.displayPreparationMs>0&&timing.preparationAndCameraSpanMs>=Math.max(timing.ms,timing.displayPreparationMs));
    }
    await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(false));
  }
  if(localCubicComparison)await capture('offer-material','material',.5,.5,'2','aligned','monotone','positive');
  else if(interpolationComparison)await capture('offer-material','material',1,1,'2','aligned','interpolating','interpolating');
  else await capture('offer-material','material',.5,.25);
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
