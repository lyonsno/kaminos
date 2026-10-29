import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [root,origin,out,name,sourceReport]=process.argv.slice(2);
const kernel=process.env.DISPLAY_OFFER_KERNEL??'monotone';
const report={ok:false,phase:'source',root,origin,name,sourceReport,errors:[],captures:[]};
await fs.mkdir(out,{recursive:true});
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
let context,page;
try {
  await save();
  assert.ok(['monotone','interpolating'].includes(kernel),'Unknown offer kernel');
  const witness=await fs.readFile(new URL(import.meta.url));
  await fs.writeFile(out+'/witness.mjs',witness);
  report.witnessSha256=createHash('sha256').update(witness).digest('hex');
  const identity=await import(pathToFileURL(root+'/scene-authoring-witness-identity.mjs'));
  report.serving=await identity.verifyAuthoringServer({origin,repoRoot:process.env.OFFER_SERVED_ROOT});
  assert.ok(process.env.OFFER_EXPECTED_SHA,'Exact offered source revision is required');
  assert.equal(report.serving.source.commit,process.env.OFFER_EXPECTED_SHA);
  const previous=JSON.parse(await fs.readFile(sourceReport));
  const url=new URL(previous.offer);url.host=new URL(origin).host;
  report.sourceUrl=url.href;
  const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
  report.executable=process.env.CHROMIUM_EXECUTABLE;
  assert.ok(report.executable.includes('Google Chrome for Testing'));
  context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,
    args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu'],viewport:{width:1380,height:900}});
  page=context.pages()[0];page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
  let rejectFatal;const fatal=new Promise((_,reject)=>rejectFatal=reject);fatal.catch(()=>{});
  const step=p=>Promise.race([p,fatal]);
  process.once('SIGTERM',()=>rejectFatal(Error('Offer witness cancelled')));
  page.on('pageerror',e=>{report.errors.push(e.message);void save();rejectFatal(e);});
  page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void save();
    if(/PRESET LOAD FAILED|invalid shader|device lost|error while/i.test(m.text()))rejectFatal(Error(m.text()));}});
  const invoke=(op,input)=>step(page.evaluate(({op,input})=>{document.activeElement?.blur();return window.kaminosWorkbenchExperiments.invoke(op,input);},{op,input}));
  const load=async target=>{
    await step(page.goto(target,{waitUntil:'domcontentloaded'}));
    report.loadedUrl=page.url();await save();
    await step(page.waitForFunction(()=>window.kaminosWorkbenchExperimentError||window.__kaminosVolumePrototype?.debugState().error||
      (window.kaminosWorkbenchExperiments?.state().id==='flame'&&window.__kaminosVolumePrototype?.debugState().active)));
    assert.ok(!await page.evaluate(()=>window.kaminosWorkbenchExperimentError||window.__kaminosVolumePrototype?.debugState().error));
  };
  report.phase='load';await save();await load(url.href);
  await invoke('setPaused',true);await invoke('select','domain');
  await invoke('setControls',{'volume-resolution':'32','volume-grid-height-ratio':2.25,'volume-render-scale':.8,'volume-steps':32,
    'volume-raymarch-mode':'fixed','volume-ray-noise-animated':false,'volume-display-reconstruction':'material',
    'volume-display-grid-scale':'2','volume-display-alignment':'aligned',
    'volume-emission-interpolation':kernel,'volume-smoke-interpolation':'positive',
    'volume-emission-smoothing':.5,'volume-smoke-smoothing':.5});
  report.camera=await page.evaluate(()=>{
    window.kaminosViewportSettings.set({overlays:false,gizmos:false,hints:false});
    return window.kaminosSetCameraDebugPose({position:[1.8,2,6.5],target:[.13,1.25,-.08]});
  });
  report.phase='evolve';await save();await invoke('setPaused',false);
  await step(page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=65));
  await invoke('setPaused',true);
  const capture=async(label,controls)=>{
    await invoke('setControls',controls);
    const frame=await step(page.evaluate(async()=>{
      const r=window.__kaminosVolumePrototype;const f=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
      if(!f.ok||f.simAdvanced||!f.image)throw Error('Missing held native frame');
      const c=document.createElement('canvas');c.width=f.image.width;c.height=f.image.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.image.rgba),c.width,c.height),0,0);
      return {state:r.debugState(),png:c.toDataURL().split(',')[1],rgba:f.image.rgba,width:c.width,height:c.height};
    }));
    const bytes=Buffer.from(frame.rgba);
    await fs.writeFile(out+'/'+label+'.png',Buffer.from(frame.png,'base64'));await fs.writeFile(out+'/'+label+'.rgba',bytes);
    delete frame.png;delete frame.rgba;
    assert.ok(new Set(bytes).size>8);
    assert.equal(frame.state.backend,'WebGPU:apple');
    const d=frame.state.displayReconstruction;
    assert.equal(d.requested,controls['volume-display-reconstruction']);
    assert.equal(d.effective,controls['volume-display-reconstruction']!=='off');
    for(const [key,value] of Object.entries(controls)){
      const keys={'volume-display-grid-scale':'scale','volume-display-alignment':'alignment',
        'volume-emission-interpolation':'emissionInterpolation','volume-smoke-interpolation':'smokeInterpolation',
        'volume-emission-smoothing':'emission','volume-smoke-smoothing':'smoke'};
      if(keys[key])assert.equal(d[keys[key]],key==='volume-display-grid-scale'?Number(value):value);
    }
    report.captures.push({label,...frame,sha256:createHash('sha256').update(bytes).digest('hex')});await save();
  };
  const native={'volume-display-reconstruction':'off'};
  const cubic={'volume-display-reconstruction':'material','volume-display-grid-scale':'2','volume-display-alignment':'aligned',
    'volume-emission-interpolation':kernel,'volume-smoke-interpolation':'positive',
    'volume-emission-smoothing':.5,'volume-smoke-smoothing':.5};
  await capture('native',native);
  await capture('legacy-4-linear',{...cubic,'volume-display-grid-scale':'4','volume-display-alignment':'cell-centred','volume-emission-smoothing':0,'volume-smoke-smoothing':0});
  await capture('aligned-2-linear',{...cubic,'volume-emission-smoothing':0,'volume-smoke-smoothing':0});
  await capture('aligned-2-cubic',cubic);await capture('aligned-2-held',cubic);await capture('native-return',native);
  assert.equal(report.captures[0].sha256,report.captures[5].sha256);
  assert.equal(report.captures[3].sha256,report.captures[4].sha256);
  assert.equal(report.captures[3].state.displayReconstruction.builds,report.captures[4].state.displayReconstruction.builds);
  assert.equal(new Set(report.captures.map(c=>c.state.simStepCount)).size,1);
  await capture('spline-mixed',{...cubic,'volume-emission-interpolation':'interpolating'});
  await capture('local-mixed',{...cubic,'volume-emission-interpolation':'monotone'});
  assert.notEqual(report.captures.at(-1).sha256,report.captures.at(-2).sha256,'local mode must visibly differ from spline');
  await invoke('setControls',{...cubic,'volume-ray-noise-animated':true,'volume-steps':8,'volume-raymarch-mode':'numerical','volume-render-scale':.6});
  await page.locator('#flame-view-look').click();
  for(const [id,value] of [['volume-display-alignment','cell-centred'],['volume-display-alignment','aligned'],
    ['volume-emission-interpolation','positive'],['volume-emission-interpolation','interpolating'],['volume-emission-interpolation',kernel],
    ['volume-smoke-interpolation','monotone'],['volume-smoke-interpolation','interpolating'],['volume-smoke-interpolation','positive']]){
    const control=page.locator('#selected-'+id);await control.scrollIntoViewIfNeeded();await control.selectOption(value);
    assert.equal(await page.locator('#'+id).inputValue(),value);
  }
  await invoke('setPaused',false);
  report.saved=await step(page.evaluate(name=>window.saveSceneAs({result:true,name}),name));await save();
  assert.equal(report.saved.ok,true,JSON.stringify(report.saved));
  const finalUrl=new URL(origin+'/index.html');const params=new URLSearchParams(url.hash.slice(1));
  params.set('scene',name+'.kaminos.json');finalUrl.hash=params.toString();report.offer=finalUrl.href;
  report.phase='cold-reopen';await save();await load(report.offer);
  await step(page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=60));
  await invoke('select','domain');await page.locator('#flame-view-look').click();
  await page.locator('#selected-volume-display-reconstruction').scrollIntoViewIfNeeded();
  report.reopened=await page.evaluate(()=>({runtime:window.__kaminosVolumePrototype.debugState(),water:window.kaminosLocalLiquidState(),camera:window.kaminosCameraDebugState(),experiment:window.kaminosWorkbenchExperiments.state()}));
  const r=report.reopened.runtime;
  assert.equal(r.displayReconstruction.requested,'material');assert.equal(r.displayReconstruction.effective,true);
  assert.equal(r.controls.resolution,32);assert.deepEqual(r.simGridDimensions,[32,72,32]);
  assert.deepEqual(r.displayReconstruction.grid,[63,143,63]);assert.equal(r.controls.raySteps,8);
  assert.equal(r.displayReconstruction.alignment,'aligned');
  assert.equal(r.displayReconstruction.emissionInterpolation,kernel);assert.equal(r.displayReconstruction.smokeInterpolation,'positive');
  assert.equal(r.displayReconstruction.emission,.5);assert.equal(r.displayReconstruction.smoke,.5);
  assert.equal(report.reopened.water.mounted,false);assert.equal(report.reopened.experiment.id,'flame');
  await page.screenshot({path:out+'/workbench.png'});
  for(let i=0;i<4;i++){
    await step(page.waitForFunction(n=>window.__kaminosVolumePrototype.debugState().simStepCount>=n,r.simStepCount+(i+1)*5));
    await page.screenshot({path:out+'/motion-'+i+'.png'});
  }
  await invoke('setPaused',true);
  await page.setViewportSize({width:430,height:900});
  await page.screenshot({path:out+'/narrow.png'});
  report.ok=true;report.phase='complete';
}catch(e){report.error=String(e.stack);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context?.close();await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,offer:report.offer}));}
