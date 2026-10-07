import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import {admitSceneGIComparison,admitSceneGILinearAddition,sceneGIRestoreIdentity} from './scene-gi-evidence.mjs';
const [url,out,root,operation] = process.argv.slice(2);
const executable=process.env.KAMINOS_BROWSER_EXECUTABLE || '/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const playwrightModule=process.env.KAMINOS_PLAYWRIGHT_MODULE || '/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs';
await fs.mkdir(out,{recursive:true});
const report={requestedUrl:url,expectedRoot:root,executable,playwrightModule,status:'running',phase:'load',errors:[],httpErrors:[],views:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
await save();let browser,page;
try {
  const {chromium}=await import(playwrightModule);
  report.runtime=await(await fetch(new URL('/api/runtime-config',url))).json();
  assert.equal(report.runtime.source.repoRoot,root);
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(0);
  page.on('pageerror',e=>{report.errors.push(String(e.stack||e));void save();});
  page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:')){report.errors.push(m.text());void save();}});
  page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).pathname!=='/favicon.ico'){report.httpErrors.push({url:r.url(),status:r.status()});void save();}});
  await page.goto(new URL('/api/runtime-config',url).href);
  report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,isFallbackAdapter:a.isFallbackAdapter};});
  assert.ok(!report.adapter.isFallbackAdapter&&!/swiftshader/i.test(JSON.stringify(report.adapter)));
  await page.goto(url);
  await page.waitForFunction(()=>window.__kaminosSceneRadianceSetup?.status==='failed'||window.__kaminosVolumePrototype?.debugState().error||(window.kaminosSceneObjectDebugState?.().some(o=>o.id==='kiln')&&window.__kaminosSceneRadiance?.canRender()&&window.__kaminosVolumePrototype.debugState().frameCount>=12),null,{timeout:0});
  report.phase='loaded';await save();
  await page.evaluate(()=>{window.setGizmoMode?.(null);window.__kaminosVolumePrototype.setSimulationPaused(true);window.__kaminosSetSceneCameraFrame([3,2,9],[0,.7,0]);window.__kaminosSetActiveTab('assets');window.kaminosWorkspace?.setMode('workbench');document.getElementById('right-tab-rendering').click();});
  if(operation==='--composition') {
    await page.selectOption('#rendering-light-mode','shared');
    await page.selectOption('#rendering-angular-samples','12');
    await page.selectOption('#rendering-angular-pattern','source');
    await page.check('#rendering-surface-scattering');
    await page.waitForTimeout(1000);
  }
  if(operation==='--product-controls'||operation==='--product-controls-guided') {
    const productPattern=operation==='--product-controls-guided'?'guided':'source';
    report.phase='product-controls';await save();
    await page.evaluate(()=>{window.kaminosWorkspace.setMode('authoring');window.kaminosWorkspace.setContext('scene');document.getElementById('authoring-render-slot').open=true;});
    await page.evaluate(()=>window.kaminosAuthoringParameters.set('@scene-gi',{mode:'combined'}));
    if(productPattern==='guided') {
      await page.evaluate(()=>window.kaminosAuthoringParameters.set('@scene-transport',{'rendering-angular-pattern':'guided','rendering-angular-samples':'8'}));
      await page.locator('#scene-lighting-quality').evaluate(node=>node.open=true);
      const beforeSpacing=await page.evaluate(()=>({value:window.kaminosAuthoringParameters.read('@scene-transport')['rendering-receiver-spacing'],history:window.kaminosSceneEdits.state().undoCount}));
      await page.selectOption('#rendering-receiver-spacing','0.16');
      assert.equal(await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),beforeSpacing.history+1);
      await page.evaluate(()=>window.kaminosSceneEdits.undo());assert.equal(await page.locator('#rendering-receiver-spacing').inputValue(),beforeSpacing.value);
      await page.evaluate(()=>window.kaminosSceneEdits.redo());assert.equal(await page.locator('#rendering-receiver-spacing').inputValue(),'0.16');
      report.receiverHistory={before:beforeSpacing,after:await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),redo:'0.16'};
    }
    report.giValidation=await page.evaluate(()=>{
      const api=window.kaminosAuthoringParameters,edits=window.kaminosSceneEdits;
      const before=api.read('@scene-gi'),history=edits.state().undoCount,attempts=[];
      for(const mode of ['unsupported',17,null]) {
        let error=null;try{api.set('@scene-gi',{mode});}catch(e){error=e.message;}
        attempts.push({mode,error,state:api.read('@scene-gi'),history:edits.state().undoCount});
      }
      api.set('@scene-gi',{mode:'gtao'});const legacy=api.read('@scene-gi');
      api.set('@scene-gi',{});return {before,history,attempts,legacy,absent:api.read('@scene-gi')};
    });
    for(const attempt of report.giValidation.attempts){assert.match(attempt.error,/Invalid/);assert.deepEqual(attempt.state,report.giValidation.before);assert.equal(attempt.history,report.giValidation.history);}
    assert.equal(report.giValidation.legacy.mode,'combined');assert.equal(report.giValidation.absent.mode,'combined');
    for(const id of ['scene-gi-mode','rendering-angular-pattern','rendering-smoke-solver','rendering-surface-scattering','rendering-retain-comparisons','rendering-angular-swap','rendering-light-mode','rendering-match-flame-camera','exposure-slider'])assert.equal(await page.locator('#'+id).isVisible(),false,`${id} remains on normal authoring surface`);
    const settle=async()=>{const frame=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);await page.waitForFunction(f=>window.__kaminosVolumePrototype.debugState().frameCount>f+2,frame,{timeout:0});};
    const sourceHash=async()=>createHash('sha256').update(JSON.stringify(await page.evaluate(async()=> (await window.__kaminosVolumePrototype.sampleSceneVolumeSource()).values))).digest('hex');
    await settle();report.sourceBefore=await sourceHash();
    const before=await page.evaluate(()=>window.kaminosAuthoringParameters.read('@scene-camera'));
    await page.locator('#scene-camera-ev').click();await page.locator('#scene-camera-ev').fill(String(before.exposureEV+1));await page.locator('#scene-camera-ev').blur();await settle();
    report.camera=await page.evaluate(()=>({scene:window.kaminosSceneEmissiveCameraDebugState(),volume:window.__kaminosVolumePrototype.debugState().sceneCamera,settings:window.kaminosAuthoringParameters.read('@scene-camera')}));
    assert.equal(report.camera.scene.exposureEV,before.exposureEV+1);assert.equal(report.camera.volume.exposureEV,report.camera.scene.exposureEV);assert.equal(report.camera.scene.source,'scene-camera');
    report.cameraSource=await sourceHash();assert.equal(report.cameraSource,report.sourceBefore,'camera changed emitted source');
    await page.locator('#scene-gi-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/scene-camera.png`});
    await page.evaluate(()=>window.kaminosSceneEdits.undo());assert.deepEqual(await page.evaluate(()=>window.kaminosAuthoringParameters.read('@scene-camera')),before);
    const sampleNow=await page.evaluate(()=>performance.now());
    const opacityBefore=await page.evaluate(now=>window.__kaminosVolumePrototype.sampleFrame({advanceSim:false,includeRgba:true,now}),sampleNow);
    await fs.writeFile(`${out}/appearance-before-frame.json`,JSON.stringify(opacityBefore));assert.ok(opacityBefore.ok);
    await page.locator('#smoke-illumination-trim').click();await page.locator('#smoke-illumination-trim').fill('1');await page.locator('#smoke-illumination-trim').blur();await settle();
    assert.equal(await page.locator('#selected-smoke-illumination-trim').inputValue(),'1');
    await page.evaluate(()=>{window.selectSceneField('flame-field');window.kaminosWorkspace.setContext('object');});
    await page.locator('#selected-smoke-illumination-trim').click();await page.locator('#selected-smoke-illumination-trim').fill('2');await page.locator('#selected-smoke-illumination-trim').blur();await settle();
    assert.equal(await page.locator('#smoke-illumination-trim').inputValue(),'2');
    const trimHistory=await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount);
    await page.locator('#selected-flame-appearance-trim').click();await page.locator('#selected-flame-appearance-trim').fill('.25');await page.locator('#selected-flame-appearance-trim').blur();await settle();
    assert.equal(await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),trimHistory+1);
    report.appearance=await page.evaluate(()=>({settings:window.kaminosAuthoringParameters.read('@scene-appearance'),volume:window.__kaminosVolumePrototype.debugState().appearanceTrims}));
    assert.deepEqual(report.appearance.settings,{flameStops:.25,smokeStops:2});assert.equal(report.appearance.volume.effective,true);
    assert.equal(report.appearance.volume.flameStops,.25);
    report.appearanceSource=await sourceHash();assert.equal(report.appearanceSource,report.sourceBefore,'presentation trims changed emitted source');
    const opacityAfter=await page.evaluate(now=>window.__kaminosVolumePrototype.sampleFrame({advanceSim:false,includeRgba:true,now}),sampleNow);
    await fs.writeFile(`${out}/appearance-after-frame.json`,JSON.stringify(opacityAfter));assert.ok(opacityAfter.ok);
    assert.equal(opacityBefore.image.rgba.length,opacityBefore.image.width*opacityBefore.image.height*4);
    assert.equal(opacityAfter.image.rgba.length,opacityBefore.image.rgba.length);
    let alphaChanged=0,rgbChanged=0,partialAlphaPixels=0;
    for(let i=0;i<opacityBefore.image.rgba.length;i++) {
      if(i%4===3&&opacityBefore.image.rgba[i]>0&&opacityBefore.image.rgba[i]<255)partialAlphaPixels++;
      if(opacityBefore.image.rgba[i]!==opacityAfter.image.rgba[i]){if(i%4===3)alphaChanged++;else rgbChanged++;}
    }
    report.appearancePixels={alphaChanged,rgbChanged,partialAlphaPixels,width:opacityBefore.image.width,height:opacityBefore.image.height};assert.ok(partialAlphaPixels>0,'opaque output cannot prove opacity preservation');assert.equal(alphaChanged,0,'appearance trims changed visible opacity');assert.ok(rgbChanged>0,'appearance trims did not change visible radiance');
    await page.screenshot({path:`${out}/flame-appearance.png`});
    await page.evaluate(()=>window.kaminosSceneEdits.undo());assert.equal(await page.locator('#flame-appearance-trim').inputValue(),'0');
    await page.evaluate(()=>window.kaminosSceneEdits.redo());assert.equal(Number(await page.locator('#flame-appearance-trim').inputValue()),.25);
    report.decimalHistory={before:trimHistory,after:await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),undo:0,redo:.25};
    report.transport=await page.evaluate(()=>({settings:window.kaminosAuthoringParameters.read('@scene-transport'),runtime:window.__kaminosSceneRadiance.debugState()}));
    assert.equal(report.transport.runtime.frame.angularPattern,productPattern);assert.equal(report.transport.runtime.smokeMode,'distributed');assert.equal(report.transport.runtime.surfaceScattering,true);
    if(productPattern==='guided'){assert.equal(report.transport.runtime.frame.directions,8);assert.equal(report.transport.settings['rendering-receiver-spacing'],'0.16');}
    await page.evaluate(()=>document.getElementById('composition-label').value='Product lighting controls witness');
    report.phase='save-reopen';await save();
    report.saved=await page.evaluate(()=>window.saveSceneAs({result:true}));assert.ok(report.saved?.ok,JSON.stringify(report.saved));
    assert.deepEqual(report.saved.document.postprocessing.sceneCamera,before);assert.deepEqual(report.saved.document.postprocessing.volumeAppearance,report.appearance.settings);
    const restored=new URL(url),hash=new URLSearchParams(restored.hash.slice(1));hash.set('scene',report.saved.filename);restored.hash=hash.toString();await page.goto(restored.href);
    await page.waitForFunction(()=>document.getElementById('info-bar').textContent.startsWith('Scene loaded:'),null,{timeout:0});
    await settle();report.reopened=await page.evaluate(()=>({camera:window.kaminosAuthoringParameters.read('@scene-camera'),appearance:window.kaminosAuthoringParameters.read('@scene-appearance'),transport:window.kaminosAuthoringParameters.read('@scene-transport')}));
    assert.deepEqual(report.reopened.camera,before);assert.deepEqual(report.reopened.appearance,report.appearance.settings);assert.equal(report.reopened.transport['rendering-angular-pattern'],productPattern);
    if(productPattern==='guided')assert.equal(report.reopened.transport['rendering-receiver-spacing'],'0.16');
    await page.evaluate(()=>{window.kaminosWorkspace.setContext('scene');document.getElementById('authoring-render-slot').open=true;});
    await page.locator('#scene-gi-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/reopened.png`});
    await page.setViewportSize({width:800,height:700});await page.waitForTimeout(500);await page.screenshot({path:`${out}/compact.png`});
    report.restoreValidation=[];
    for(const mode of ['unsupported',17,null,'gtao',undefined]) {
      const data=structuredClone(report.saved.document);if(mode===undefined)delete data.postprocessing.sceneGI.mode;else data.postprocessing.sceneGI.mode=mode;
      const prior=await page.evaluate(()=>({gi:window.kaminosAuthoringParameters.read('@scene-gi'),history:window.kaminosSceneEdits.state().undoCount,objects:window.kaminosSceneObjectDebugState().map(o=>o.id)}));
      await page.evaluate(()=>document.getElementById('info-bar').textContent='');
      await page.locator('#scene-file-input').setInputFiles({name:'gi-validation.kaminos.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
      const invalid=!['gtao',undefined].includes(mode);
      await page.waitForFunction(bad=>{const text=document.getElementById('info-bar').textContent;return bad?text==='Invalid scene format':text.startsWith('Scene loaded:');},invalid,{timeout:0});
      const after=await page.evaluate(()=>({gi:window.kaminosAuthoringParameters.read('@scene-gi'),history:window.kaminosSceneEdits.state().undoCount,objects:window.kaminosSceneObjectDebugState().map(o=>o.id)}));
      report.restoreValidation.push({mode:mode===undefined?'absent':mode,invalid,prior,after});
      if(invalid)assert.deepEqual(after,prior);else assert.equal(after.gi.mode,'combined');
      await save();
    }
    report.phase='vacuum';await save();
    await page.evaluate(()=>{
      window.__kaminosVolumePrototype.setSimulationPaused(true);
      for(const id of ['volume-physical-thermal','volume-physical-clean','volume-physical-smoke-extinction'])window.kaminosAuthoringParameters.set('@parameter:'+id,{value:0});
      window.kaminosAuthoringParameters.set('@scene-camera',{exposureEV:8});
    });await settle();
    const vacuumSource=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());
    await fs.writeFile(`${out}/vacuum-source.json`,JSON.stringify(vacuumSource));assert.equal(vacuumSource.kind,'coefficients');assert.equal(vacuumSource.channels,4);assert.equal(vacuumSource.values.length,vacuumSource.dimensions.reduce((a,b)=>a*b,4));assert.ok(vacuumSource.values.every(v=>v===0),'vacuum input contains emission or extinction');
    const vacuum=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleFrame({advanceSim:false,includeRgba:true,now:performance.now()}));
    await fs.writeFile(`${out}/vacuum-frame.json`,JSON.stringify(vacuum));assert.ok(vacuum.ok);assert.equal(vacuum.image.rgba.length,vacuum.image.width*vacuum.image.height*4);
    report.vacuum={cameraEV:8,sourceComponents:vacuumSource.values.length,pixels:vacuum.image.width*vacuum.image.height,nonzeroAlpha:vacuum.image.rgba.filter((v,i)=>i%4===3&&v!==0).length};
    assert.equal(report.vacuum.nonzeroAlpha,0,'zero-source volume darkens the scene');
  } else if(operation==='--light-coupling') {
    report.phase='light-coupling';report.coupling=[];await save();
    await page.selectOption('#scene-gi-mode','combined');await page.selectOption('#scene-gi-view','gi');
    await page.evaluate(()=>window.kaminosAuthoringParameters.set('@scene-gi',{gain:10}));
    report.beds=await page.evaluate(()=>{
      const beds=window.kaminosSceneObjectDebugState().filter(o=>o.type==='procedural-mesh');
      for(const bed of beds)window.kaminosSceneAuthoring.setMaterial(bed.id,{glow:0});
      return beds;
    });
    for(const [name,mode,transport,surface] of [['off','neither',0,0],['base','shared',0,0],['transport4','shared',4,0],['surface4','shared',0,4],['surfaceLow','shared',0,-8],['offAgain','neither',0,0]]) {
      await page.evaluate(({mode,transport,surface})=>window.kaminosAuthoringParameters.set('@scene-transport',{'rendering-light-mode':mode,'rendering-shared-gain':transport,'rendering-surface-gain':surface}),{mode,transport,surface});
      await page.waitForTimeout(600);
      const state=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),light:window.__kaminosSceneRadiance.debugState(),transport:window.kaminosAuthoringParameters.read('@scene-transport')}));
      const buffers=await page.evaluate(async()=>Object.fromEntries(await Promise.all(['source','incoming','receiving'].map(async kind=>[kind,await window.kaminosSceneGIReadback(kind)]))));
      for(const [kind,buffer] of Object.entries(buffers)){await fs.writeFile(`${out}/${name}-${kind}.json`,JSON.stringify(buffer));delete buffer.base64;}
      report.coupling.push({name,...state,buffers});await page.screenshot({path:`${out}/${name}.png`});await save();
    }
  } else if(operation==='--live-preview') {
    report.phase='live-preview';await save();
    await page.evaluate(()=>{window.kaminosWorkspace.setMode('authoring');window.kaminosWorkspace.setContext('scene');document.getElementById('authoring-render-slot').open=true;window.__kaminosVolumePrototype.setSimulationPaused(false);});
    await page.waitForTimeout(4000);
    report.preview=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),volume:window.__kaminosVolumePrototype.debugState(),lighting:window.kaminosAuthoringParameters.read('@scene-transport')}));
    assert.equal(report.preview.gi.gain,10);assert.equal(report.preview.gi.effectiveMode,'combined');assert.equal(report.preview.lighting['rendering-surface-gain'],0);assert.ok(report.preview.volume.frameCount>12);assert.equal(report.preview.volume.error,null);
    await page.locator('#scene-gi-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/live-authoring.png`});
    await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
    await page.setViewportSize({width:800,height:700});await page.waitForTimeout(500);await page.screenshot({path:`${out}/compact.png`});
  } else if(operation==='--authoring') {
    report.phase='authoring-controls';await save();
    await page.evaluate(()=>{window.kaminosWorkspace.setMode('authoring');window.kaminosWorkspace.setContext('scene');document.getElementById('authoring-render-slot').open=true;});
    await page.selectOption('#scene-gi-mode','combined');
    await page.locator('#scene-gi-mode').blur();
    report.before=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),camera:window.kaminosAuthoringParameters.read('@scene-camera'),transport:window.kaminosAuthoringParameters.read('@scene-transport')}));
    assert.equal(await page.locator('#scene-camera-fields [data-authoring-alias="volume-physical-exposure"]').count(),1);
    assert.equal(await page.locator('#shared-flame-domain-properties [data-authoring-alias="volume-physical-exposure"]').count(),0);
    report.phase='gain-gesture';await save();
    await page.locator('#scene-gi-gain').click();await page.locator('#scene-gi-gain').fill('5');await page.locator('#scene-gi-gain').blur();
    assert.equal(await page.evaluate(()=>window.kaminosSceneGIDebugState().gain),5);
    await page.evaluate(()=>window.kaminosSceneEdits.undo());
    assert.equal(await page.evaluate(()=>window.kaminosSceneGIDebugState().gain),report.before.gi.gain);
    await page.evaluate(()=>window.kaminosSceneEdits.redo());
    assert.equal(await page.evaluate(()=>window.kaminosSceneGIDebugState().gain),5);
    await page.evaluate(()=>window.kaminosAuthoringParameters.set('@scene-gi',{gain:10}));
    const sourceHash=async()=>createHash('sha256').update(JSON.stringify(await page.evaluate(async()=> (await window.__kaminosVolumePrototype.sampleSceneVolumeSource()).values))).digest('hex');
    report.cameraSourceBefore=await sourceHash();
    const exposure=await page.locator('#selected-volume-physical-exposure').inputValue();
    report.phase='camera-gesture';await save();
    await page.locator('#selected-volume-physical-exposure').click();await page.locator('#selected-volume-physical-exposure').fill(String(Number(exposure)+.25));await page.locator('#selected-volume-physical-exposure').blur();
    assert.ok(Math.abs(Number(await page.locator('#volume-physical-exposure').inputValue())-(Number(exposure)+.25))<1e-12,'camera EV gesture did not apply');
    const cameraFrame=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);
    await page.waitForFunction(frame=>window.__kaminosVolumePrototype.debugState().frameCount>frame+1,cameraFrame,{timeout:0});
    report.cameraSourceDuring=await sourceHash();assert.equal(report.cameraSourceDuring,report.cameraSourceBefore,'active camera EV changed emitted source');
    await page.evaluate(()=>window.kaminosSceneEdits.undo());
    assert.equal(await page.locator('#volume-physical-exposure').inputValue(),exposure);
    report.cameraSourceAfter=await sourceHash();assert.equal(report.cameraSourceAfter,report.cameraSourceBefore,'camera grading changed raw emitted source');
    report.phase='direction-swap-history';await save();
    await page.evaluate(()=>{
      window.kaminosAuthoringParameters.set('@scene-transport',{'rendering-angular-samples':'24','rendering-shared-gain':0});
      window.kaminosAuthoringParameters.set('@scene-transport',{'rendering-angular-samples':'12'});
      window.kaminosAuthoringParameters.set('@scene-transport',{'rendering-shared-gain':1});
    });
    const swapHistory=await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount);
    await page.locator('#rendering-angular-swap').click();
    assert.equal(await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),swapHistory+1);
    assert.equal(await page.locator('#rendering-angular-samples').inputValue(),'24');
    await page.evaluate(()=>window.kaminosSceneEdits.undo());
    assert.equal(await page.locator('#rendering-angular-samples').inputValue(),'12');assert.equal(await page.locator('#rendering-shared-gain').inputValue(),'1');
    await page.evaluate(()=>window.kaminosSceneEdits.redo());
    assert.equal(await page.locator('#rendering-angular-samples').inputValue(),'24');assert.equal(await page.locator('#rendering-shared-gain').inputValue(),'1');
    report.swapHistory={before:swapHistory,after:await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),undo:{directions:12,gain:1},redo:{directions:24,gain:1}};
    await page.evaluate(()=>{
      window.kaminosAuthoringParameters.set('@scene-ground',{'composition-ground-color':'#808080','composition-ground-roughness':.65});
      window.kaminosAuthoringParameters.set('@scene-transport',{'rendering-light-mode':'shared','rendering-shared-gain':0,'rendering-surface-gain':.5});
      document.getElementById('composition-label').value='Handy integrated lighting authoring';
    });
    report.effective=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),ground:window.kaminosGroundDebugState(),camera:window.kaminosAuthoringParameters.read('@scene-camera'),transport:window.kaminosAuthoringParameters.read('@scene-transport')}));
    await page.waitForTimeout(1000);
    await page.locator('#scene-gi-panel').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/authoring-lighting.png`});
    await page.locator('#scene-camera-fields').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/authoring-camera.png`});
    report.phase='save-reopen';await save();
    report.saved=await page.evaluate(()=>window.saveSceneAs({result:true}));
    assert.ok(report.saved?.ok,JSON.stringify(report.saved));
    report.savedFile=await page.evaluate(()=>new URLSearchParams(location.hash.slice(1)).get('scene'));
    // Save returns the effective server path, not the requested filename hint.
    const filename=report.saved.filename || report.saved.path || report.saved.file;
    assert.ok(filename,JSON.stringify(report.saved));
    report.savedDocument=await(await fetch(new URL(`/api/read?root=scenes&path=${encodeURIComponent(filename)}`,url))).json();
    assert.equal(report.savedDocument.postprocessing.sceneGI.gain,10);
    assert.deepEqual(report.savedDocument.postprocessing.lighting['@scene-camera'],report.effective.camera);
    assert.deepEqual(report.savedDocument.postprocessing.lighting['@scene-transport'],report.effective.transport);
    const reopened=new URL(url);const hash=new URLSearchParams(reopened.hash.slice(1));hash.set('scene',filename);reopened.hash=hash.toString();
    await page.goto(reopened.href);
    await page.waitForFunction(()=>window.__kaminosSceneRadianceSetup?.status==='failed'||document.getElementById('info-bar').textContent.startsWith('Scene loaded:'),null,{timeout:0});
    report.reopened=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),ground:window.kaminosGroundDebugState(),camera:window.kaminosAuthoringParameters.read('@scene-camera'),transport:window.kaminosAuthoringParameters.read('@scene-transport'),workspace:window.kaminosWorkspace.state()}));
    assert.equal(report.reopened.gi.gain,10);assert.deepEqual(report.reopened.camera,report.effective.camera);assert.deepEqual(report.reopened.transport,report.effective.transport);
    await page.evaluate(()=>{window.__kaminosVolumePrototype.setSimulationPaused(true);window.kaminosWorkspace.setContext('scene');document.getElementById('authoring-render-slot').open=true;});
    await page.locator('#scene-gi-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/reopened.png`});
    await page.setViewportSize({width:800,height:700});await page.waitForTimeout(500);await page.screenshot({path:`${out}/compact.png`});
  } else if(operation==='--floor-preview') {
    report.phase='floor-controls';await save();
    const initial=await page.evaluate(()=>window.kaminosGroundDebugState());
    report.initialGround=initial;
    assert.equal(await page.getAttribute('#scene-gi-gain','value'),'10','new UI gain default');
    const setInput=async(id,value)=>page.$eval('#'+id,(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},value);
    await setInput('composition-ground-color','#606060');
    await setInput('composition-ground-roughness',.9);
    const edited=await page.evaluate(()=>window.kaminosGroundDebugState());
    assert.equal(edited.color,'#606060');assert.equal(edited.roughness,.9);
    await setInput('composition-ground-color','#808080');
    await setInput('composition-ground-roughness',.65);
    report.ground=await page.evaluate(()=>window.kaminosGroundDebugState());
    assert.equal(report.ground.color,'#808080');assert.equal(report.ground.roughness,.65);assert.equal(report.ground.metalness,0);
    await page.selectOption('#rendering-light-mode','shared');
    await page.selectOption('#scene-gi-mode','combined');
    await page.selectOption('#scene-gi-view','scene');
    await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(false));
    await page.waitForTimeout(3000);
    await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
    for(const gain of [0,10]) {
      await page.$eval('#scene-gi-gain',(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}));},gain);
      await page.waitForTimeout(750);
      const state=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),ground:window.kaminosGroundDebugState(),lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState()}));
      assert.equal(state.gi.gain,gain);assert.equal(state.volume.error,null);
      report.views.push({name:'gray-floor-gain'+gain,...state});
      await page.screenshot({path:`${out}/gray-floor-gain${gain}.png`});await save();
    }
    await page.evaluate(()=>{window.kaminosWorkspace.setMode('authoring');document.querySelector('[data-inspector-context="scene"]').click();});
    await page.locator('#composition-ground-color').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${out}/floor-controls.png`});
    const scene=await(await fetch(new URL('/api/read?root=scenes&path=cheap-kiln-shared-source.kaminos.json',url))).json();
    scene.environment.ground={...scene.environment.ground,color:'#606060',roughness:.9};
    scene.postprocessing.sceneGI={mode:'combined',gain:3};
    scene._filename='handy-floor-restore-'+basename(out)+'.kaminos.json';
    scene.composition.label='Handy floor restore check';
    report.requestedRestoreFilename=scene._filename;await save();
    await page.setInputFiles('#scene-file-input',{name:'floor-roundtrip.kaminos.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scene))});
    await page.waitForFunction(()=>window.kaminosGroundDebugState?.().color==='#606060'&&window.kaminosSceneGIDebugState?.().gain===3,null,{timeout:0});
    Object.assign(report,sceneGIRestoreIdentity(scene._filename,page.url()));
    report.restored={ground:await page.evaluate(()=>window.kaminosGroundDebugState()),gi:await page.evaluate(()=>window.kaminosSceneGIDebugState())};
    assert.equal(report.restored.ground.roughness,.9);assert.equal(report.restored.gi.gain,3,'authored gain survives default change');
  } else {
  const signal=await page.evaluate(async()=>({source:await window.__kaminosVolumePrototype.sampleSceneVolumeSource(),lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState()}));
  await fs.writeFile(`${out}/held-source.json`,JSON.stringify(signal));
  assert.equal(signal.volume.error,null);assert.ok(signal.lighting.frame.surfaceReceivers>0);
  report.sourceHash=createHash('sha256').update(JSON.stringify(signal.source.values)).digest('hex');
  report.phase='comparison';await save();
  for(const [name,mode,view,gain] of [['baseline','gtao','scene',1],['combined','combined','scene',1],['zero','combined','scene',0],['bounce','combined','gi',1],['incoming','combined','incoming',1],['visibility','combined','ao',1],['restored','gtao','scene',1]]) {
    const frameBefore=await page.evaluate(()=>window.kaminosSceneGIDebugState().frames);
    await page.selectOption('#scene-gi-mode',mode);
    if(mode==='combined') {
      await page.selectOption('#scene-gi-view',view);
      await page.$eval('#scene-gi-gain',(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}));},gain);
    }
    await page.waitForTimeout(1500);
    const state=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState()}));
    assert.equal(await page.locator('#gtao-shape-controls').isVisible(),mode==='gtao','only active estimator controls should be visible');
    assert.equal(await page.locator('#scene-gi-panel #ao-toggle').count(),1,'AO strength must share the GI control surface');
    if(mode==='combined'){assert.equal(state.gi.view,view);assert.equal(state.gi.gain,gain);assert.ok(state.gi.frames>frameBefore);}
    report.views.push({name,frameBefore,...state});await save();
    const png=await page.screenshot({path:`${out}/${name}.png`});
    report.views.at(-1).pixels=await page.evaluate(async base64=>{
      const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
      const bounds=document.getElementById('viewport').getBoundingClientRect();
      const data=ctx.getImageData(bounds.x,bounds.y+100,bounds.width,bounds.height-200).data;
      const chunks=[];for(let i=0;i<data.length;i+=16384)chunks.push(String.fromCharCode(...data.subarray(i,i+16384)));
      let lo=255,hi=0;data.forEach((v,i)=>{if(i%4<3){lo=Math.min(lo,v);hi=Math.max(hi,v);}});
      return {width:bounds.width,height:bounds.height-200,base64:btoa(chunks.join('')),range:hi-lo};
    },png.toString('base64'));
    const pixels=report.views.at(-1).pixels;
    await fs.writeFile(`${out}/${name}.rgba`,Buffer.from(pixels.base64,'base64'));
    report.views.at(-1).pixels={width:pixels.width,height:pixels.height,range:pixels.range,path:`${out}/${name}.rgba`};await save();
    if(name==='combined') {
      const raw=await page.evaluate(()=>window.kaminosSceneGIReadback());
      await fs.writeFile(`${out}/gi-raw.rgba16f`,Buffer.from(raw.base64,'base64'));
      assert.equal(raw.stats.finite,true);
      report.giRaw={width:raw.width,height:raw.height,format:raw.format,...raw.stats};await save();
    }
    assert.equal(state.gi.effectiveMode,mode);assert.equal(state.volume.error,null);
    if(mode==='combined')assert.ok(state.gi.frames>0,'combined shader never executed');
  }
  const final=await page.evaluate(async()=>await window.__kaminosVolumePrototype.sampleSceneVolumeSource());
  const sourceAfter=createHash('sha256').update(JSON.stringify(final.values)).digest('hex');
  assert.equal(sourceAfter,report.sourceHash);
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);
  const evidence={native:report.adapter.vendor==='apple'&&!report.adapter.isFallbackAdapter,root:report.runtime.source.repoRoot,expectedRoot:root,errors:report.errors,sourceBefore:report.sourceHash,sourceAfter,giRaw:report.giRaw};
  for(const name of ['baseline','restored','combined','zero','bounce','visibility']) {
    const v=report.views.find(v=>v.name===name);
    evidence[name]={...v.pixels,view:v.gi.view,gain:v.gi.gain,frameBefore:v.frameBefore,frameAfter:v.gi.frames,values:await fs.readFile(`${out}/${name}.rgba`)};
  }
  report.pixelComparison=admitSceneGIComparison(evidence);
  if(operation==='--composition') {
    report.phase='linear-composition';await save();
    await page.selectOption('#scene-gi-mode','combined');
    await page.uncheck('#ao-toggle');
    const fields={};
    for(const [name,view,gain] of [['zero','scene',0],['lit','scene',1],['received','gi',1]]) {
      await page.selectOption('#scene-gi-view',view);
      await page.$eval('#scene-gi-gain',(e,v)=>{e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}));},gain);
      await page.waitForTimeout(750);
      const raw=await page.evaluate(()=>window.kaminosSceneGIReadback('receiving'));
      assert.equal(raw.kind,'receiving');assert.equal(raw.view,view);assert.equal(raw.stats.finite,true);
      assert.equal(raw.format,'rgba16f-little-endian');
      await fs.writeFile(`${out}/linear-${name}.rgba16f`,Buffer.from(raw.base64,'base64'));
      fields[name]=raw;
      await page.screenshot({path:`${out}/ao-off-${name}.png`});
    }
    const {DataUtils}=await import('./lib/three.webgpu.js');
    const decode=raw=>{const b=Buffer.from(raw.base64,'base64');return Array.from({length:b.length/2},(_,i)=>DataUtils.fromHalfFloat(b.readUInt16LE(i*2)));};
    const zero=decode(fields.zero),lit=decode(fields.lit),received=decode(fields.received);
    assert.equal(zero.length,lit.length);assert.equal(lit.length,received.length);
    const groundProbe=await page.evaluate(()=>window.kaminosSceneGIReceiverAt(.95,.94));
    assert.equal(groundProbe?.isGround,true,'ground assay pixel must intersect the actual scene ground');
    const px=Math.floor(fields.lit.width*.95),py=Math.floor(fields.lit.height*.94);
    const regions=[{name:'full'},{name:'identified-ground',x0:px-2,x1:px+3,y0:py-2,y1:py+3}];
    report.linearComposition={aoEnabled:false,width:fields.lit.width,height:fields.lit.height,regions:[]};
    report.linearComposition.groundProbe={u:.95,v:.94,...groundProbe};
    for(const region of regions) {
      report.linearComposition.regions.push({...region,...admitSceneGILinearAddition({zero,lit,received,width:fields.lit.width,height:fields.lit.height,region:region.name==='full'?null:region})});
      await save();
    }
    await page.check('#ao-toggle');
    await page.selectOption('#scene-gi-view','scene');
    await page.evaluate(()=>{window.kaminosWorkspace?.setMode('authoring');document.querySelector('[data-inspector-context="scene"]').click();document.getElementById('authoring-render-slot').open=true;});
    assert.equal(await page.locator('#authoring-render-slot #scene-gi-mode').count(),1);
    assert.equal(await page.locator('#scene-gi-mode').isVisible(),true);
    await page.screenshot({path:`${out}/unified-scene.png`});
  }
  if(operation==='--benchmark') {
    report.phase='benchmark';report.performance=[];await save();
    for(const mode of ['gtao','combined','gtao']) {
      await page.selectOption('#scene-gi-mode',mode);
      if(mode==='combined')await page.selectOption('#scene-gi-view','scene');
      await page.waitForTimeout(3000);
      const sample=await page.evaluate(async()=>{
        const start=performance.now(),before=window.kaminosSceneGIDebugState(),frames=[];
        while(performance.now()-start<5000) {
          await new Promise(requestAnimationFrame);
          frames.push({time:performance.now()-start,sceneFrames:window.kaminosSceneGIDebugState().sceneFrames});
        }
        const after=window.kaminosSceneGIDebugState(),elapsed=performance.now()-start;
        return {before,after,elapsed,frames,sceneFramesPerSecond:(after.sceneFrames-before.sceneFrames)*1000/elapsed};
      });
      report.performance.push({mode,...sample,scope:'whole-app-render-invocation-throughput-not-GPU-only-or-presentation'});await save();
    }
  }
  }
  report.runtimeAfter=await(await fetch(new URL('/api/runtime-config',url))).json();
  assert.deepEqual(report.runtimeAfter.source,report.runtime.source,'source revision changed during witness');
  assert.deepEqual(report.errors,[]);
  assert.deepEqual(report.httpErrors,[]);
  report.status='captured';report.phase='complete';
} catch(e) {report.status='failed';report.error=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});}
finally {await save();await browser?.close();}
