import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertSofteningView} from './beaming-softening-evidence.mjs';
import {assertCameraPixels,assertSurfaceTrimPixels} from './beaming-camera-pixels.mjs';
import {assertSurfaceView,floatEvidenceBytes,assertSourceMotionView,assertLitSourceMotionResponse,assertScatteringView,assertRequiredModuleResponse} from './beaming-surface-evidence.mjs';
const [url,out]=process.argv.slice(2);
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
await fs.mkdir(out,{recursive:true});
const report={requestedUrl:url,executable,status:'running',phase:'load',errors:[],httpFailures:[],views:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
await save();let browser,page;
try {
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  report.runtime=await(await fetch(new URL('/api/runtime-config',url))).json();
  const scene=await fetch(new URL('/api/read?root=scenes&path=cheap-kiln-shared-source.kaminos.json',url));
  assert.ok(scene.ok,'authored kiln scene is not mounted');
  report.scene=await scene.json();
  assert.ok((await fetch(new URL(report.scene.model.source,url))).ok,'authored kiln mesh is not mounted');
  await fs.access(executable);
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
  if(process.argv.includes('--required-module-negative'))await page.route('**/scene-distributed-radiance.mjs',route=>route.fulfill({status:404,body:'deliberate owned witness missing module'}));
  let rejectModuleLoad;const moduleFailure=new Promise((_,reject)=>{rejectModuleLoad=reject;});moduleFailure.catch(()=>{});
  if(process.argv.includes('--scattering-check')){
    if(process.argv.includes('--disconnect-surface-trim'))await page.route('**/scene-distributed-radiance.mjs',async route=>{
      const response=await route.fetch(),original=await response.text(),needle='received.mul(surfaceGain)';assert.equal(original.split(needle).length,2);
      const body=original.replace(needle,'received');report.disconnectedTrimInstrumentation={original,body,reportedControlRetained:true};await save();await route.fulfill({response,body});
    });
    await page.route('**/scene-volume-gather.mjs',async route=>{
      const response=await route.fetch(),original=await response.text(),needle='  const resources=[];';assert.equal(original.split(needle).length,2);
      const body="import {installGatherProfiler} from './scratch/beaming-gather-profiler.mjs';\n"+original.replace(needle,needle+' installGatherProfiler(device);');
      report.gatherInstrumentation={original,body};await save();await route.fulfill({response,body});
    });
  }
  if(process.argv.includes('--source-aware-light-only')) {
    await page.route(u=>u.pathname==='/'||u.pathname==='/index.html',async route=>{
      const response=await route.fetch(),original=await response.text();
      const needle='  function renderSceneFrame() {';assert.equal(original.split(needle).length,2);
      const body=original.replace(needle,"  window.__beamingEnvironment=()=>({intensity:scene.environmentIntensity,exposure:renderer.toneMappingExposure,rim:document.getElementById('rim-enabled').checked});\n"+needle);
      report.environmentInstrumentation={url:route.request().url(),original,body};await save();
      await route.fulfill({response,body});
    });
  }
  if(process.argv.includes('--surface-cost-check')) {
    await page.route('**/scene-surface-reconstruction.mjs',async route=>{
      const response=await route.fetch(),original=await response.text();
      const needle='  const resources=[];';assert.equal(original.split(needle).length,2);
      const body=original.replace(needle,'  if(!window.__beamingSurfaceFixture||graph.count>window.__beamingSurfaceFixture.graph.count)window.__beamingSurfaceFixture={device,graph,front,back,dimensions};\n'+needle);
      report.surfaceInstrumentation={url:route.request().url(),original,body};await save();
      await route.fulfill({response,body});
    });
  }
  if(process.argv.includes('--camera-match-check')) {
    // Independent native reference in this owned browser only. Bypass the feature
    // node/selector for a reference, then restore the exact prior pipeline state.
    await page.route(u=>u.pathname==='/'||u.pathname==='/index.html',async route=>{
      const response=await route.fetch(),original=await response.text();
      const needle='    renderPipeline.render();';assert.equal(original.split(needle).length,2);
      assert.equal(original.split('  function renderSceneFrame() {').length,2);
      const body=original.replace('  function renderSceneFrame() {','  let beamingSavedCamera=null;\n  function renderSceneFrame() {').replace(needle,`
    if(window.__beamingNativeCamera) {
      if(!beamingSavedCamera)beamingSavedCamera={node:renderPipeline.outputNode,transform:renderPipeline.outputColorTransform};
      renderPipeline.outputNode=rawSceneOutput;renderPipeline.outputColorTransform=true;renderPipeline.needsUpdate=true;
      window.__beamingNativeCameraFrames=(window.__beamingNativeCameraFrames||0)+1;
    } else if(beamingSavedCamera) {
      renderPipeline.outputNode=beamingSavedCamera.node;renderPipeline.outputColorTransform=beamingSavedCamera.transform;renderPipeline.needsUpdate=true;beamingSavedCamera=null;
    }
${needle}`);
      report.cameraInstrumentation={url:route.request().url(),original,body};await save();
      await route.fulfill({response,body});
    });
  }
  if(process.argv.includes('--orientation-diagnosis')) {
    // Owned browser instrumentation only; never changes the operator's tab or source.
    await page.route('**/scene-distributed-radiance.mjs',async route=>{
      const response=await route.fetch();const original=await response.text();
      const needle='material.setupMaterialLightings=function(builder)';
      assert.ok(original.includes(needle));
      const body=original.replace(needle,'material.beamingReceived=received; window.__beamingReceiverScene=scene; '+needle);
      report.instrumentation={url:route.request().url(),original,body};await save();
      await route.fulfill({response,body});
    });
  }
  page.on('response',r=>{if(r.status()>=400){const response={url:r.url(),status:r.status()};report.httpFailures.push(response);
    try{assertRequiredModuleResponse(response,new URL(url).origin);}catch(error){report.phase='required-module-load-failed';rejectModuleLoad(error);}void save();}});
  page.on('pageerror',e=>{report.errors.push(String(e));void save();});
  page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico')){report.errors.push(`${m.location().url}: ${m.text()}`);void save();}});
  await page.goto(new URL('/api/runtime-config',url).href);
  report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {...a.info.toJSON?.(),vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description,isFallbackAdapter:a.isFallbackAdapter};});
  assert.ok(!report.adapter.isFallbackAdapter&&!/swiftshader/i.test(JSON.stringify(report.adapter)),'software fallback cannot establish native performance');
  await save();
  await page.goto(url);
  await Promise.race([page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().error
    ||window.__kaminosSceneRadianceSetup?.status==='failed'
    ||(window.kaminosSceneObjectDebugState?.().length>0&&window.__kaminosSceneRadiance?.canRender()&&window.__kaminosVolumePrototype.debugState().frameCount>=120),null,{timeout:0}),moduleFailure]);
  report.observed=await page.evaluate(()=>({effectiveUrl:location.href,setup:window.__kaminosSceneRadianceSetup,
    lighting:window.__kaminosSceneRadiance?.debugState(),volume:window.__kaminosVolumePrototype?.debugState(),objects:window.kaminosSceneObjectDebugState?.()}));
  assert.equal(report.observed.setup.status,'mounted');
  assert.equal(report.observed.lighting.identity,'distributed-volume-direct-radiance-v0');
  assert.ok(report.observed.lighting.frame.surfaceReceivers>0);
  assert.ok(report.observed.objects.length>0);
  assert.equal(report.observed.volume.error,null);
  await page.evaluate(()=>{window.setGizmoMode?.(null);window.__kaminosVolumePrototype.setSimulationPaused(true);
    window.__kaminosSetSceneCameraFrame([3,2,9],[0,.7,0]);window.__kaminosSetActiveTab('assets');window.kaminosWorkspace?.setMode('workbench');});
  if(await page.locator('#right-tab-rendering').isVisible())await page.click('#right-tab-rendering');
  report.phase='held-camera-comparison';await save();
  report.receiverStats=await page.evaluate(async()=>{
    const fields=await window.__kaminosSceneRadiance.readback();
    const source=await window.__kaminosVolumePrototype.sampleSceneVolumeSource();
    function stats(data){let max=0,sum=0,positive=0;for(let i=0;i<data.length;i+=4){const v=Math.max(data[i],data[i+1],data[i+2]);max=Math.max(max,v);sum+=v;if(v>0)positive++;}return {max,mean:sum/(data.length/4),positive,count:data.length/4};}
    return {surface:stats(fields.surface.data),surfaceBack:fields.surfaceBack?stats(fields.surfaceBack.data):null,smoke:stats(fields.smoke.data),source:stats(source.values),rawSource:source};
  });await save();
  for(const mode of ['shared','neither']) {
    await page.selectOption('#rendering-light-mode',mode);await page.waitForTimeout(700);
    await page.screenshot({path:`${out}/${mode}.png`});
    report.views.push(await page.evaluate(()=>({mode:document.getElementById('rendering-light-mode').value,lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState()})));await save();
  }
  if(process.argv.includes('--gain-sweep')) {
    await page.selectOption('#rendering-light-mode','shared');
    for(const stops of [4,8]){
      await page.evaluate(stops=>{const gain=document.getElementById('rendering-shared-gain');gain.value=String(stops);gain.dispatchEvent(new Event('input',{bubbles:true}));},stops);
      await page.waitForTimeout(700);await page.screenshot({path:`${out}/gain-${stops}.png`});
      report.views.push(await page.evaluate(()=>({mode:'shared',gainStops:Number(document.getElementById('rendering-shared-gain').value),lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState()})));await save();
    }
  }
  if(process.argv.includes('--receiving-check')) {
    report.phase='receiving-and-smoke-mode-comparison';await save();
    await page.selectOption('#rendering-light-mode','shared');
    await page.selectOption('#rendering-angular-samples','96');
    await page.evaluate(()=>{const gain=document.getElementById('rendering-shared-gain');gain.value='4';gain.dispatchEvent(new Event('input',{bubbles:true}));});
    for(const smokeMode of ['legacy','distributed']) {
      await page.selectOption('#rendering-smoke-solver',smokeMode);
      await page.waitForFunction(mode=>{const d=window.__kaminosSceneRadiance.debugState(),v=window.__kaminosVolumePrototype.debugState();return d.directions===96&&d.smokeMode===mode&&d.frame?.volumeReceivers===(mode==='legacy'?0:8192)&&v.physicalColor.incidentLight.legacyDispatched===(mode==='legacy');},smokeMode,{timeout:0});
      for(const [name,position,target] of [['interior',[0,1,6],[0,.7,0]],['opposite',[-3,2,7],[0,.7,0]],['floor',[3,6,7],[0,-.5,0]],['roof',[0,6,3],[0,1,0]]]) {
        await page.evaluate(({position,target})=>window.__kaminosSetSceneCameraFrame(position,target),{position,target});
        await page.waitForTimeout(700);
        const view=await page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState()}));
        assert.equal(view.lighting.smokeMode,smokeMode);assert.equal(view.lighting.directions,96);
        assert.equal(view.volume.physicalColor.incidentLight.legacyDispatched,smokeMode==='legacy');
        assert.equal(view.lighting.frame.volumeReceivers,smokeMode==='legacy'?0:8192);
        assert.equal(view.volume.error,null);
        await page.screenshot({path:`${out}/${smokeMode}-${name}.png`});
        report.views.push({name,smokeMode,position,target,...view});await save();
      }
    }
  }
  if(process.argv.includes('--winding-check')) {
    if(process.argv.includes('--orientation-diagnosis'))await page.evaluate(async()=>{window.__beamingThree=await import('/lib/three.webgpu.js');});
    report.phase='double-sided-orientation-comparison';await save();
    await page.selectOption('#rendering-light-mode','shared');
    await page.selectOption('#rendering-angular-samples','96');
    await page.selectOption('#rendering-smoke-solver','distributed');
    await page.evaluate(()=>{
      window.selectSceneObject('kiln');window.toggleBackface();window.toggleDoubleSided();window.setGizmoMode?.(null);
      window.__kaminosSetSceneCameraFrame([-3,2,7],[0,.7,0]);
      const gain=document.getElementById('rendering-shared-gain');gain.value='4';gain.dispatchEvent(new Event('input',{bubbles:true}));
    });
    let originalSource;
    for(const [name,operation] of [['original',null],['reversed-winding','reverseWinding'],['reversed-winding-and-normals','flipNormals']]) {
      const prior=await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().frame.generation);
      if(operation)await page.evaluate(operation=>window[operation](),operation);
      await page.waitForFunction(prior=>{const d=window.__kaminosSceneRadiance.debugState();return d.frame.generation>prior&&d.directions===96&&window.__kaminosSceneRadiance.canRender();},prior,{timeout:0});
      await page.waitForTimeout(700);
      const view=await page.evaluate(async()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),
        source:await window.__kaminosVolumePrototype.sampleSceneVolumeSource(),objects:window.kaminosSceneObjectDebugState(),doubleSided:document.getElementById('tb-double-sided').classList.contains('active')}));
      report.views.push({name,operation,...view});await save();
      assert.equal(view.doubleSided,true);assert.ok(view.objects.some(o=>o.id==='kiln'&&o.active),'orientation operation must target kiln');
      assert.equal(view.volume.error,null);assert.equal(view.lighting.smokeMode,'distributed');
      assert.equal(view.lighting.frame.smokeReconstruction.identity,'prepared-geometry-visible-v1');
      if(originalSource)assert.deepEqual(view.source.values,originalSource,'orientation comparison requires identical raw source coefficients');
      else originalSource=view.source.values;
      await page.screenshot({path:`${out}/orientation-${name}.png`});
      if(process.argv.includes('--orientation-ao-check')) {
        const enabled=await page.isChecked('#ao-toggle');
        await page.uncheck('#ao-toggle');await page.waitForTimeout(700);
        await page.screenshot({path:`${out}/ao-off-${name}.png`});
        report.views.at(-1).aoCheck={wasEnabled:enabled,effectiveEnabled:await page.isChecked('#ao-toggle')};await save();
        if(enabled)await page.check('#ao-toggle');
      }
      if(process.argv.includes('--orientation-diagnosis')) {
        const fields=await page.evaluate(async()=>{
          const read=await window.__kaminosSceneRadiance.readback();
          return Object.fromEntries(Object.entries(read).map(([key,value])=>[key,{dimensions:value.dimensions,data:Array.from(value.data)}]));
        });
        await fs.writeFile(`${out}/receivers-${name}.json`,JSON.stringify(fields));
        report.views.at(-1).materialProbe=await page.evaluate(()=>{
          const THREE=window.__beamingThree; // assigned below through the real module
          const rows=[];window.__beamingReceiverScene.traverseVisible(mesh=>{
            if(!mesh.isMesh)return;for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
              if(!m.beamingReceived)continue;
              rows.push({name:mesh.name,side:m.side,metalness:m.metalness,metalnessMap:!!m.metalnessMap,map:!!m.map,normalMap:!!m.normalMap,flatShading:m.flatShading});
              m.outputNode=THREE.TSL.vec4(m.beamingReceived,1);m.needsUpdate=true;
            }
          });return rows;
        });
        await page.waitForTimeout(700);await page.screenshot({path:`${out}/irradiance-${name}.png`});
        await page.evaluate(()=>window.__beamingReceiverScene.traverseVisible(mesh=>{
          if(!mesh.isMesh)return;for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){if(m.beamingReceived){m.outputNode=null;m.needsUpdate=true;}}
        }));
        await save();
      }
    }
  }
  if(process.argv.includes('--prepared-check')) {
    report.phase='prepared-smoke-consumer';await save();
    await page.selectOption('#rendering-light-mode','shared');
    await page.selectOption('#rendering-angular-samples','96');
    await page.evaluate(()=>{const gain=document.getElementById('rendering-shared-gain');gain.value='4';gain.dispatchEvent(new Event('input',{bubbles:true}));});
    const digest=data=>createHash('sha256').update(Buffer.from(new Float32Array(data).buffer)).digest('hex');
    const fields=async name=>{
      const values=await page.evaluate(async()=>{const r=await window.__kaminosSceneRadiance.readback();return Object.fromEntries(Object.entries(r).map(([k,v])=>[k,{dimensions:v.dimensions,data:Array.from(v.data)}]));});
      await fs.writeFile(`${out}/${name}-receivers.json`,JSON.stringify(values));
      return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{dimensions:v.dimensions,sha256:digest(v.data)}]));
    };
    const effective=()=>page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),
      density:Number(document.getElementById('volume-density').value),extinction:Number(document.getElementById('volume-physical-smoke-extinction').value)}));
    const settled=async()=>{const prior=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);await page.waitForFunction(p=>window.__kaminosVolumePrototype.debugState().frameCount>=p+10,prior,{timeout:0});};
    let heldSurface;
    for(const mode of ['legacy','distributed']) {
      await page.selectOption('#rendering-smoke-solver',mode);await settled();
      const state=await effective();const values=await fields(`prepared-${mode}`);
      assert.equal(state.lighting.smokeMode,mode);assert.equal(state.volume.physicalColor.incidentLight.legacyDispatched,mode==='legacy');
      if(heldSurface){assert.equal(values.surface.sha256,heldSurface.surface.sha256);assert.equal(values.surfaceBack.sha256,heldSurface.surfaceBack.sha256);}
      else heldSurface=values;
      report.views.push({name:`prepared-${mode}`,fields:values,...state});await save();
    }
    for(const [name,density,extinction,position,target] of [
      ['authored',null,null,[0,1,6],[0,.7,0]],
      ['thin-smoke',.35,.1,[0,1,6],[0,.7,0]],
      ['zero-extinction',.35,0,[0,1,6],[0,.7,0]],
      ['roof',.35,0,[0,6,3],[0,1,0]],
    ]) {
      await page.evaluate(({density,extinction,position,target})=>{
        for(const [id,value] of [['volume-density',density],['volume-physical-smoke-extinction',extinction]])if(value!==null){const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));}
        window.__kaminosSetSceneCameraFrame(position,target);
      },{density,extinction,position,target});
      await settled();const state=await effective();
      assert.equal(state.volume.error,null);assert.equal(state.lighting.frame.smokeReconstruction.identity,'prepared-geometry-visible-v1');
      assert.equal(state.lighting.frame.smokeReconstruction.staticPreparations,1);assert.ok(state.lighting.frame.smokeReconstruction.updates>0);
      assert.equal(state.lighting.smokeMode,'distributed');assert.equal(state.lighting.directions,96);assert.equal(state.lighting.frame.volumeReceivers,8192);
      assert.equal(JSON.stringify(state.lighting.frame.smokeReconstruction.dimensions),'[64,128,64]');
      assert.equal(state.lighting.frame.smokeReconstruction.cameraTriangleTests,0);assert.equal(state.volume.physicalColor.incidentLight.legacyDispatched,false);
      if(density!==null){assert.equal(state.density,density);assert.equal(state.extinction,extinction);
        assert.equal(state.volume.controls.density,density);assert.equal(state.volume.controls.physicalSmokeExtinction,extinction);
        assert.ok(Math.abs(state.volume.physicalColor.material.smokeExtinction-extinction)<1e-6,'effective material extinction must match control');}
      await page.screenshot({path:`${out}/prepared-${name}.png`});
      report.views.push({name:`prepared-${name}`,position,target,...state});await save();
    }
  }
  if(process.argv.includes('--softening-check')) {
    report.phase='held-source-softening';await save();
    const thin=process.argv.includes('--softening-thin');
    report.softeningProfile={thin,directions:24,gain:thin?4:16,position:thin?[3,2,9]:[0,1,6],target:[0,.7,0]};await save();
    await page.selectOption('#rendering-light-mode','shared');
    await page.selectOption('#rendering-angular-samples','24');
    await page.selectOption('#rendering-smoke-solver','distributed');
    await page.evaluate(thin=>{
      window.__kaminosSetSceneCameraFrame(thin?[3,2,9]:[0,1,6],[0,.7,0]);
      const gain=document.getElementById('rendering-shared-gain');gain.value=thin?'2':'4';gain.dispatchEvent(new Event('input',{bubbles:true}));
      if(thin)for(const [id,value] of [['volume-density',.35],['volume-physical-smoke-extinction',.1]]){const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));}
    },thin);
    const digest=data=>createHash('sha256').update(Buffer.from(new Float32Array(data).buffer)).digest('hex');
    let baselineSource,baselineSurface,baselineSmoke;const softened=[];
    for(const [name,passes] of [['baseline',0],['soft4',4],['soft16',16],['restored',0]]){
      await page.evaluate(passes=>{const e=document.getElementById('rendering-source-softness');e.value=String(passes);e.dispatchEvent(new Event('input',{bubbles:true}));},passes);
      const prior=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);
      await page.waitForFunction(({passes,prior})=>{
        const d=window.__kaminosSceneRadiance.debugState();return d.frame?.sourceSoftness===passes&&d.directions===24&&window.__kaminosVolumePrototype.debugState().frameCount>=prior+10;
      },{passes,prior},{timeout:0});
      const signal=await page.evaluate(async()=>{
        const fields=await window.__kaminosSceneRadiance.readback();
        return {lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),
          source:await window.__kaminosVolumePrototype.sampleSceneVolumeSource(),surface:Array.from(fields.surface.data),surfaceBack:Array.from(fields.surfaceBack.data),smoke:Array.from(fields.smoke.data)};
      });
      await fs.writeFile(`${out}/softening-${name}-signal.json`,JSON.stringify(signal));
      assert.equal(signal.volume.error,null);assert.equal(signal.lighting.frame.sourceSoftness,passes);
      assert.equal(signal.lighting.directions,24);assert.equal(signal.lighting.gain,thin?4:16);
      if(thin){assert.equal(signal.volume.controls.density,.35);assert.equal(signal.volume.controls.physicalSmokeExtinction,.1);}
      const sourceHash=digest(signal.source.values),surfaceHash=digest(signal.surface),smokeHash=digest(signal.smoke);
      if(name==='baseline'){baselineSource=sourceHash;baselineSurface=surfaceHash;baselineSmoke=smokeHash;}
      else assert.equal(sourceHash,baselineSource,'softness must leave actual raw emission/extinction unchanged');
      assertSofteningView(signal,{passes,gain:thin?4:16,sourceHash,baselineSource,surfaceHash,baselineSurface,smokeHash,baselineSmoke,thin});
      if(passes>0){assert.notEqual(surfaceHash,baselineSurface,'softness must actually change receiver light');softened.push(surfaceHash);
        assert.equal(signal.lighting.frame.sourceSoftening.staticPreparations,1);}
      if(name==='restored')assert.equal(surfaceHash,baselineSurface,'zero must restore exact surface transport');
      await page.screenshot({path:`${out}/softening-${name}.png`});
      report.views.push({name:`softening-${name}`,passes,sourceHash,surfaceHash,smokeHash,lighting:signal.lighting,volume:signal.volume});await save();
    }
    assert.notEqual(softened[0],softened[1],'independent softness control must affect light');
  }
  if(process.argv.includes('--camera-match-check')) {
    report.phase='held-camera-match';await save();
    await page.selectOption('#rendering-light-mode','shared');
    await page.evaluate(()=>window.__kaminosSetSceneCameraFrame([2,1.5,6],[0,.7,0]));
    const digest=data=>createHash('sha256').update(Buffer.from(new Float32Array(data).buffer)).digest('hex');
    const {PNG}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright-core/lib/utilsBundle.js');
    const pixels={};let nativeReference;
    let sourceHash,surfaceHash;
    for(const [name,enabled,ev,white,knee] of [['host',false,0,6500,.6],['matched',true,0,6500,.6],['ev',true,1,6500,.6],['white',true,0,4000,.6],['knee',true,0,6500,.2],['restored',false,0,6500,.6]]) {
      await page.setChecked('#rendering-match-flame-camera',enabled);
      await page.evaluate(({ev,white,knee})=>{
        for(const [id,value] of [['volume-physical-exposure',ev],['volume-physical-white',white],['volume-physical-knee',knee]]) {
          const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));
        }
      },{ev,white,knee});
      const f=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);
      await page.waitForFunction(f=>{const v=window.__kaminosVolumePrototype.debugState();return v.error||window.__kaminosSceneRadianceSetup?.status==='failed'||v.frameCount>=f+3;},f,{timeout:0});
      const state=await page.evaluate(()=>({camera:window.kaminosSceneEmissiveCameraDebugState(),volume:window.__kaminosVolumePrototype.debugState(),lighting:window.__kaminosSceneRadiance.debugState()}));
      report.lastTrustworthyState=state;await save();assert.equal(state.volume.error,null);
      assert.equal(state.camera.effective,enabled);assert.equal(state.camera.requested,enabled);
      assert.equal(state.volume.physicalColor.exposureEV,Math.fround(ev));assert.equal(state.volume.physicalColor.whiteBalanceKelvin,white);assert.equal(state.volume.physicalColor.highlightKnee,Math.fround(knee));
      if(enabled){assert.equal(state.camera.exposureEV,Math.fround(ev));assert.equal(state.camera.whiteBalanceKelvin,white);assert.equal(state.camera.highlightKnee,Math.fround(knee));}
      const signal=await page.evaluate(async()=>({source:await window.__kaminosVolumePrototype.sampleSceneVolumeSource(),surface:Array.from((await window.__kaminosSceneRadiance.readback()).surface.data)}));
      await fs.writeFile(`${out}/camera-${name}-signal.json`,JSON.stringify(signal));
      const sh=digest(signal.source.values),rh=digest(signal.surface);
      if(!sourceHash){sourceHash=sh;surfaceHash=rh;}assert.equal(sh,sourceHash);assert.equal(rh,surfaceHash,'camera must not alter raw received light');
      pixels[name]=PNG.sync.read(await page.screenshot({path:`${out}/camera-${name}.png`}));
      if(name==='host') {
        await page.evaluate(()=>{window.__beamingNativeCamera=true;});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.ok(await page.evaluate(()=>window.__beamingNativeCameraFrames>0),'independent native pipeline reference must actually render');
        nativeReference=PNG.sync.read(await page.screenshot({path:`${out}/camera-native-reference.png`}));
        await page.evaluate(()=>{window.__beamingNativeCamera=false;});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      }
      report.views.push({name:`camera-${name}`,...state,sourceHash:sh,surfaceHash:rh});await save();
    }
    report.cameraPixelVerification={status:'checking-independent-native-reference'};await save();
    report.cameraPixelVerification={status:'passed',...assertCameraPixels(nativeReference,pixels)};await save();
  }
  if(process.argv.includes('--angular-pattern-check')) {
    report.phase='held-angular-pattern';await save();
    const lit=process.argv.includes('--angular-lit-check');
    report.angularProfile={camera:lit?[2,1.5,6]:[3,2,9],target:[0,.7,0],gainStops:lit?4:2,softness:5,density:.35,smokeExtinction:.1};await save();
    await page.selectOption('#rendering-light-mode','shared');
    await page.evaluate(profile=>{
      window.__kaminosSetSceneCameraFrame(profile.camera,profile.target);
      for(const [id,value] of [['rendering-shared-gain',profile.gainStops],['rendering-source-softness',profile.softness],['volume-density',profile.density],['volume-physical-smoke-extinction',profile.smokeExtinction]]) {
        const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));
      }
    },report.angularProfile);
    let sourceHash,baselineSurface,builds;
    const digest=data=>createHash('sha256').update(Buffer.from(new Float32Array(data).buffer)).digest('hex');
    for(const [name,count,pattern,rotation] of [['fixed24',24,'fixed',0],['rotated24',24,'fixed',.7],['restored24',24,'fixed',0],['fixed16',16,'fixed',0],['fixed12',12,'fixed',0],['spatial24',24,'spatial',0],['spatial16',16,'spatial',0],['spatial12',12,'spatial',0]]) {
      await page.selectOption('#rendering-angular-samples',String(count));
      await page.selectOption('#rendering-angular-pattern',pattern);
      await page.evaluate(({pattern,rotation})=>{window.__kaminosSceneRadiance.setAngularPattern(pattern,rotation);},{pattern,rotation});
      const f=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);
      await page.waitForFunction(f=>{const v=window.__kaminosVolumePrototype.debugState();return v.error||window.__kaminosSceneRadianceSetup?.status==='failed'||v.frameCount>=f+3;},f,{timeout:0});
      report.lastTrustworthyState=await page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),setup:window.__kaminosSceneRadianceSetup}));await save();
      assert.equal(report.lastTrustworthyState.volume.error,null);
      assert.notEqual(report.lastTrustworthyState.setup?.status,'failed');
      assert.equal(await page.$eval('#rendering-angular-samples',e=>Number(e.value)),count);
      assert.equal(await page.$eval('#rendering-angular-pattern',e=>e.value),pattern);
      const signal=await page.evaluate(async()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),source:await window.__kaminosVolumePrototype.sampleSceneVolumeSource(),surface:Array.from((await window.__kaminosSceneRadiance.readback()).surface.data)}));
      await fs.writeFile(`${out}/angular-${name}-signal.json`,JSON.stringify(signal));
      assert.equal(signal.volume.error,null);assert.equal(signal.lighting.previewStale,false);
      assert.equal(signal.lighting.frame.directions,count);assert.equal(signal.lighting.frame.angularPattern,pattern);assert.equal(signal.lighting.frame.angularRotation,rotation);
      const sh=digest(signal.source.values),rh=digest(signal.surface);
      if(!sourceHash){sourceHash=sh;baselineSurface=rh;builds=signal.lighting.geometryBuilds;}
      assert.equal(sh,sourceHash,'angular pattern must leave held raw source unchanged');assert.equal(signal.lighting.geometryBuilds,builds);
      if(name==='restored24')assert.equal(rh,baselineSurface,'restoring constellation must restore exact light');
      else if(name!=='fixed24')assert.notEqual(rh,baselineSurface,'pattern must reach actual receiver lighting');
      await page.screenshot({path:`${out}/angular-${name}.png`});
      report.views.push({name,sourceHash:sh,surfaceHash:rh,lighting:signal.lighting,volume:signal.volume});await save();
    }
  }
  if(process.argv.includes('--surface-reconstruction-check')) {
    report.phase='current-frame-surface-reconstruction';await save();
    report.surfaceGPU=await page.evaluate(async()=>{const m=await import('/scratch/beaming-surface-gpu-check.mjs');return m.checkSurfaceGPU();});await save();
    report.reconstructionProfile={camera:[2,1.5,6],target:[0,.7,0],gainStops:4,sourceSoftness:0,density:.35,smokeExtinction:.1};
    await page.selectOption('#rendering-light-mode','shared');
    await page.evaluate(p=>{
      window.__kaminosSetSceneCameraFrame(p.camera,p.target);
      for(const [id,value] of [['rendering-shared-gain',p.gainStops],['rendering-source-softness',p.sourceSoftness],['volume-density',p.density],['volume-physical-smoke-extinction',p.smokeExtinction]]) {
        const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));
      }
    },report.reconstructionProfile);
    const digest=data=>createHash('sha256').update(Buffer.from(new Float32Array(data).buffer)).digest('hex');
    let sourceHash,builds;const baselines=new Map();
    for(const [name,count,pattern,passes] of [['raw16',16,'spatial',0],['smooth16-8',16,'spatial',8],['smooth16-32',16,'spatial',32],['restored16',16,'spatial',0],['fixed16',16,'fixed',0],['raw12',12,'spatial',0],['smooth12-8',12,'spatial',8],['smooth12-32',12,'spatial',32],['restored12',12,'spatial',0]]) {
      await page.selectOption('#rendering-angular-samples',String(count));
      await page.selectOption('#rendering-angular-pattern',pattern);
      await page.evaluate(passes=>{const e=document.getElementById('rendering-surface-reconstruction');e.value=String(passes);e.dispatchEvent(new Event('input',{bubbles:true}));},passes);
      const f=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);
      await page.waitForFunction(f=>window.__kaminosVolumePrototype.debugState().error||window.__kaminosVolumePrototype.debugState().frameCount>=f+3,f,{timeout:0});
      const signal=await page.evaluate(async()=>{
        const fields=await window.__kaminosSceneRadiance.readback();
        return {lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),source:await window.__kaminosVolumePrototype.sampleSceneVolumeSource(),
          surface:Array.from(fields.surface.data),back:Array.from(fields.surfaceBack.data),smoke:Array.from(fields.smoke.data)};
      });
      await fs.writeFile(`${out}/surface-${name}-signal.json`,JSON.stringify(signal));
      const binary={};
      for(const [field,values] of Object.entries({front:signal.surface,back:signal.back,smoke:signal.smoke,source:signal.source.values})) {
        const bytes=floatEvidenceBytes(values),path=`${out}/surface-${name}-${field}.f32`;
        await fs.writeFile(path,bytes);assert.deepEqual(await fs.readFile(path),bytes,'binary evidence roundtrip mismatch');
        binary[field]={path,sha256:createHash('sha256').update(bytes).digest('hex'),negativeZeros:values.filter(v=>Object.is(v,-0)).length,format:'native-little-endian-float32'};
      }
      report.lastTrustworthyState={lighting:signal.lighting,volume:signal.volume};await save();
      assert.equal(signal.volume.error,null);assert.equal(signal.lighting.previewStale,false);
      assert.equal(signal.lighting.frame.surfaceReconstruction.passes,passes);assert.equal(signal.lighting.frame.directions,count);
      assert.equal(signal.lighting.frame.angularPattern,pattern);
      const sh=digest(signal.source.values),rh=digest(signal.surface),mh=digest(signal.smoke);
      if(!sourceHash){sourceHash=sh;builds=signal.lighting.geometryBuilds;}
      assert.equal(sh,sourceHash);assert.equal(signal.lighting.geometryBuilds,builds);
      const key=`${count}/${pattern}`;
      assertSurfaceView(signal,{baseline:baselines.get(key),count,pattern,passes});
      if(!baselines.has(key))baselines.set(key,signal);
      await page.screenshot({path:`${out}/surface-${name}.png`});
      report.views.push({name,sourceHash:sh,surfaceHash:rh,smokeHash:mh,binary,lighting:signal.lighting});await save();
    }
    if(process.argv.includes('--surface-cost-check')) {
      report.phase='surface-GPU-cost';await save();
      report.surfaceCost=await page.evaluate(async()=>{const m=await import('/scratch/beaming-surface-gpu-check.mjs');const f=window.__beamingSurfaceFixture;if(f.graph.count!==window.__kaminosSceneRadiance.debugState().frame.surfaceReceivers)throw new Error('timing fixture is not the authored receiver graph');return m.measureSurfaceGPU(f);});await save();
    }
  }
  if(process.argv.includes('--scattering-check')){
    report.phase='smoke-scattering-and-surface-trim';await save();
    const {PNG}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright-core/lib/utilsBundle.js');
    await page.selectOption('#rendering-light-mode','shared');await page.selectOption('#rendering-angular-pattern','source');
    await page.check('#rendering-retain-comparisons');await page.check('#rendering-match-flame-camera');
    await page.evaluate(()=>window.__kaminosSetSceneCameraFrame([2,1.5,6],[0,.7,0]));
    const settle=async()=>{const f=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);await page.waitForFunction(f=>window.__kaminosVolumePrototype.debugState().error||window.__kaminosVolumePrototype.debugState().frameCount>=f+3,f,{timeout:0});};
    const capture=()=>page.evaluate(async()=>{
      const lighting=window.__kaminosSceneRadiance.debugState(),volume=window.__kaminosVolumePrototype.debugState();
      const [fields,source,scattering]=await Promise.all([window.__kaminosSceneRadiance.readback(),window.__kaminosVolumePrototype.sampleSceneVolumeSource(),window.__kaminosVolumePrototype.sampleSceneVolumeScattering()]);
      return {lighting,volume,source,scattering,dimensions:{surface:fields.surface.dimensions,back:fields.surfaceBack.dimensions,smoke:fields.smoke.dimensions},surface:Array.from(fields.surface.data),back:Array.from(fields.surfaceBack.data),smoke:Array.from(fields.smoke.data)};
    });
    const near=(a,b,label)=>{assert.equal(a.length,b.length);let error=0;for(let i=0;i<a.length;i++){assert.ok(Number.isFinite(a[i])&&Number.isFinite(b[i]));error=Math.max(error,Math.abs(a[i]-b[i])/Math.max(1,Math.abs(a[i]),Math.abs(b[i])));}assert.ok(error<.00002,`${label}: ${error}`);return error;};
    for(const count of [12,16]){
      await page.selectOption('#rendering-angular-samples',String(count));let zero,high,highPixels,trimPixels;
      for(const [name,albedo,enabled,trim,master]of [['direct-zero',0,false,0,0],['scatter-zero',0,true,0,0],['scatter-high',.8,true,0,0],['surface-trim',.8,true,2,0],['surface-restore',.8,true,0,0],['master-double',.8,true,0,1],['direct-high',.8,false,0,0],['master-low',.8,true,0,-4]]){
        await page.evaluate(({albedo,enabled,trim,master})=>{
          for(const [id,value]of [['volume-physical-smoke-albedo',albedo],['rendering-surface-gain',trim],['rendering-shared-gain',master],['rendering-source-softness',0],['rendering-surface-reconstruction',0]]){const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));}
          const e=document.getElementById('rendering-surface-scattering');e.checked=enabled;e.dispatchEvent(new Event('change',{bubbles:true}));
        },{albedo,enabled,trim,master});await settle();
        const signal=await capture();assertScatteringView(signal,{count,albedo,enabled,trim,master});
        const checks={};if(name==='direct-zero')zero=signal;
        if(name==='scatter-zero'){checks.zero=near(signal.surface,zero.surface,'zero-albedo baseline');checks.source=near(signal.source.values,zero.source.values,'primary coefficients');}
        if(name==='scatter-high'){
          high=signal;checks.source=near(signal.source.values,zero.source.values,'albedo leaves primary emission/extinction');checks.smoke=near(signal.smoke,zero.smoke,'incident light independent of albedo');
          assert.ok(signal.scattering.values.some(x=>x>0),'lit kiln has no scattering coefficient');
          assert.ok(signal.surface.some((x,i)=>i%4<3&&x>zero.surface[i]+.0001),'scatter path did not light kiln surfaces');
        }
        if(name==='surface-trim'){checks.surface=near(signal.surface,high.surface,'trim leaves raw surface transport');checks.smoke=near(signal.smoke,high.smoke,'trim leaves smoke');checks.source=near(signal.source.values,high.source.values,'trim leaves source');}
        if(name==='master-double'){checks.surface=near(signal.surface,high.surface.map((x,i)=>i%4<3?2*x:x),'master doubles surface once');checks.smoke=near(signal.smoke,high.smoke.map((x,i)=>i%4<3?2*x:x),'master doubles smoke once');}
        if(name==='direct-high')checks.surface=near(signal.surface,zero.surface,'direct wall response remains independent of albedo');
        const stem=`scatter-${count}-${name}`;for(const [key,values]of [['source',signal.source.values],['scattering',signal.scattering.values],['front',signal.surface],['back',signal.back],['smoke',signal.smoke]])await fs.writeFile(`${out}/${stem}-${key}.f32`,floatEvidenceBytes(values));
        const pixels=PNG.sync.read(await page.screenshot({path:`${out}/${stem}.png`}));
        if(name==='scatter-high')highPixels=pixels;if(name==='surface-trim')trimPixels=pixels;
        if(name==='surface-restore')checks.trimPixels=assertSurfaceTrimPixels(highPixels,trimPixels,pixels);
        const digest=v=>createHash('sha256').update(floatEvidenceBytes(v)).digest('hex');
        report.views.push({name:stem,count,albedo,enabled,trim,master,checks,dimensions:signal.dimensions,lighting:signal.lighting,volume:signal.volume,sourceMetadata:{...signal.source,values:undefined},scatteringMetadata:{...signal.scattering,values:undefined},hashes:{source:digest(signal.source.values),front:digest(signal.surface),smoke:digest(signal.smoke)}});await save();
      }
      for(const enabled of [false,true]){
        await page.setChecked('#rendering-surface-scattering',enabled);await settle();
        const supported=await page.evaluate(()=>window.__beamingGatherDevice?.features.has('timestamp-query'));
        if(!supported){report.profiles??=[];report.profiles.push({count,enabled,status:'unsupported'});continue;}
        await page.evaluate(()=>{window.__beamingGatherProfile={remaining:20,records:[],errors:[]};});
        await page.waitForFunction(()=>window.__beamingGatherProfile.errors.length||window.__beamingGatherProfile.records.length===20,null,{timeout:0});
        const profile=await page.evaluate(()=>window.__beamingGatherProfile);assert.deepEqual(profile.errors,[]);assert.equal(profile.records.length,20);
        report.profiles??=[];report.profiles.push({count,enabled,status:'measured',...profile});await save();
      }
    }
    report.scatteringAdmission='matched-source-albedo-response-and-independent-surface-trim';await save();
    if(await page.evaluate(()=>!!window.kaminosWorkspace)){
      await page.evaluate(()=>{window.kaminosWorkspace.setMode('authoring');window.kaminosWorkspace.setContext('scene');document.getElementById('authoring-render-slot').open=true;});
      await page.locator('#rendering-surface-gain').scrollIntoViewIfNeeded();assert.ok(await page.locator('#rendering-surface-gain').isVisible(),'authoring Scene Rendering must expose the same live trim');
      const before=await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().surfaceGain);
      await page.evaluate(()=>{const e=document.getElementById('rendering-surface-gain');e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}));});
      assert.equal(await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().surfaceGain),2);
      await page.screenshot({path:`${out}/authoring-render-controls.png`});
      await page.evaluate(()=>window.kaminosWorkspace.setMode('workbench'));
      assert.equal(await page.evaluate(()=>document.querySelectorAll('#rendering-surface-gain').length),1,'workspace roundtrip cannot duplicate control identity');
      report.authoringControls={status:'exercised',surfaceGainBefore:before,surfaceGainAfter:2,singleControl:true};await save();
    }
    if(process.argv.includes('--domain-check')){
      report.phase='current-main-source-domain-relocation';await save();
      const baseline=await capture();assert.equal(await page.evaluate(()=>typeof window.__kaminosVolumePrototype.relocateOrdinaryDomain),'function');
      for(const translate of [[.25,0,0],[0,0,0]]){
        const first=await page.evaluate(translate=>{const p=window.__kaminosVolumePrototype;
          p.setSimulationPaused(false);p.relocateOrdinaryDomain(translate);return p.debugState().frameCount;},translate);
        await page.waitForFunction(f=>window.__kaminosVolumePrototype.debugState().error||window.__kaminosVolumePrototype.debugState().frameCount>=f+24,first,{timeout:0});
        await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));await settle();
        const shifted=await capture();assert.deepEqual(shifted.source.worldTransform.translate,translate);assert.deepEqual(shifted.lighting.sourceTransform.translate,translate);
        assert.ok(shifted.lighting.geometryBuilds>baseline.lighting.geometryBuilds);assert.equal(shifted.volume.error,null);
        const name=translate[0]?'domain-shifted':'domain-restored';await page.screenshot({path:`${out}/${name}.png`});
        report.views.push({name,sourceMetadata:{...shifted.source,values:undefined},lighting:shifted.lighting,volume:shifted.volume,scope:'live ordinary-domain API, evolving source after reset'});await save();
      }
    }
  }
  if(process.argv.includes('--source-aware-motion-check')) {
    report.phase='matched-moving-source';await save();
    const lightOnly=process.argv.includes('--source-aware-light-only');
    if(lightOnly) {
      await page.evaluate(()=>{
        // The ordinary environment slider has minimum .1. This explicitly
        // declared diagnostic permits zero in the owned browser only.
        for(const [id,value] of [['env-intensity-slider',0],['exposure-slider',1]]){const e=document.getElementById(id);if(id==='env-intensity-slider')e.min='0';e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));}
      });
      await page.uncheck('#rim-enabled');
    }
    await page.selectOption('#rendering-light-mode','shared');
    await page.check('#rendering-retain-comparisons');
    await page.evaluate(()=>{
      window.__kaminosSetSceneCameraFrame([2,1.5,6],[0,.7,0]);
      for(const [id,value] of [['rendering-shared-gain',4],['rendering-source-softness',0],['rendering-surface-reconstruction',0]]) {
        const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));
      }
    });
    const modes=[['fixed',24],['source',12],['source',16],['source',24]];
    const digest=v=>createHash('sha256').update(floatEvidenceBytes(v)).digest('hex');
    const settle=async()=>{
      const f=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);
      await page.waitForFunction(f=>window.__kaminosVolumePrototype.debugState().error||window.__kaminosSceneRadianceSetup?.status==='failed'||window.__kaminosVolumePrototype.debugState().frameCount>=f+2,f,{timeout:0});
    };
    let priorSourceHash;
    for(let state=0;state<8;state++) {
      if(state){
        const f=await page.evaluate(()=>{window.__kaminosVolumePrototype.setSimulationPaused(false);return window.__kaminosVolumePrototype.debugState().frameCount;});
        await page.waitForFunction(f=>window.__kaminosVolumePrototype.debugState().error||window.__kaminosVolumePrototype.debugState().frameCount>=f+6,f,{timeout:0});
        await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
      }
      await settle();
      const held=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());
      const sourceHash=digest(held.values);
      if(priorSourceHash)assert.notEqual(sourceHash,priorSourceHash,'sequence must contain changing live flame coefficients');
      priorSourceHash=sourceHash;
      await fs.writeFile(`${out}/motion-${state}-source.f32`,floatEvidenceBytes(held.values));
      for(const [pattern,count] of modes) {
        await page.selectOption('#rendering-angular-samples',String(count));
        await page.selectOption('#rendering-angular-pattern',pattern);
        await settle();
        const signal=await page.evaluate(async()=>{
          const fields=await window.__kaminosSceneRadiance.readback();
          return {dimensions:{surface:fields.surface.dimensions,back:fields.surfaceBack.dimensions},environment:window.__beamingEnvironment?.(),lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),
            source:await window.__kaminosVolumePrototype.sampleSceneVolumeSource(),surface:Array.from(fields.surface.data),back:Array.from(fields.surfaceBack.data)};
        });
        assertSourceMotionView(signal,{count,pattern,heldSource:held.values,lightOnly});
        const name=`motion-${state}-${pattern}${count}`;
        for(const [field,values] of [['front',signal.surface],['back',signal.back]])await fs.writeFile(`${out}/${name}-${field}.f32`,floatEvidenceBytes(values));
        await page.screenshot({path:`${out}/${name}.png`});
        const mean=v=>v.reduce((s,x,i)=>s+(i%4<3?x:0),0)/(v.length/4);
        report.views.push({name,state,pattern,count,lightOnly,dimensions:signal.dimensions,environment:signal.environment,sourceHash,surfaceHash:digest(signal.surface),frontMean:mean(signal.surface),lighting:signal.lighting,volume:signal.volume,sourceMetadata:{...signal.source,values:undefined},heldSourceMetadata:{...held,values:undefined}});
        await save();
      }
    }
    report.motionResponse={status:'unverified',scope:'observed-lit-kiln'};await save();
    const floats=async path=>{const b=await fs.readFile(path);return Array.from(new Float32Array(b.buffer,b.byteOffset,b.length/4));};
    for(const [pattern,count] of modes){
      const sequence=[];
      for(const view of report.views.filter(v=>v.pattern===pattern&&v.count===count))sequence.push({source:{values:await floats(`${out}/motion-${view.state}-source.f32`)},surface:await floats(`${out}/${view.name}-front.f32`),back:await floats(`${out}/${view.name}-back.f32`)});
      assertLitSourceMotionResponse(sequence);
    }
    report.motionResponse.status='admitted-changing-lit-receivers';await save();
  }
  if(process.argv.includes('--edit-budget-check')) {
    report.phase='edit-budget-consumer';await save();
    await page.selectOption('#rendering-light-mode','shared');
    await page.check('#rendering-retain-comparisons');
    const effective=()=>page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),badge:document.getElementById('lighting-edit-status').textContent,objects:window.kaminosSceneObjectDebugState()}));
    const settle=async()=>{
      const f=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().frameCount);
      await page.waitForFunction(f=>{
        const v=window.__kaminosVolumePrototype.debugState();
        return v.error||window.__kaminosSceneRadianceSetup?.status==='failed'||v.frameCount>=f+3;
      },f,{timeout:0});
      const state=await effective();
      report.lastTrustworthyState=state;await save();
      assert.equal(state.volume.error,null,'renderer failed while settling');
      assert.equal(state.lighting.error,undefined,'lighting preparation failed while settling');
      const setup=await page.evaluate(()=>window.__kaminosSceneRadianceSetup);
      assert.notEqual(setup?.status,'failed','lighting setup failed while settling');
    };
    const original=await effective();
    assert.equal(original.lighting.previewStale,false,'restored scene must not be stranded in an unfinished edit');
    const digest=data=>createHash('sha256').update(Buffer.from(new Float32Array(data).buffer)).digest('hex');
    let first12;
    for(const count of [12,16,24,12]) {
      const started=performance.now();await page.selectOption('#rendering-angular-samples',String(count));await settle();
      const state=await effective();
      assert.equal(state.lighting.geometryBuilds,original.lighting.geometryBuilds,'direction switch rebuilt geometry');
      assert.equal(state.lighting.frame.directions,count);
      assert.equal(state.lighting.frame.angularCache.retained,true);
      const signal=await page.evaluate(async()=>({source:await window.__kaminosVolumePrototype.sampleSceneVolumeSource(),surface:Array.from((await window.__kaminosSceneRadiance.readback()).surface.data)}));
      const sourceHash=digest(signal.source.values),surfaceHash=digest(signal.surface);
      if(count===12){if(first12){assert.equal(surfaceHash,first12.surfaceHash);assert.equal(sourceHash,first12.sourceHash);assert.equal(state.lighting.frame.angularCache.visibilityPreparations,first12.preparations+1);}else first12={sourceHash,surfaceHash,preparations:state.lighting.frame.angularCache.visibilityPreparations};}
      const name=`budget-${report.views.length}-${count}`;
      await fs.writeFile(`${out}/${name}-signal.json`,JSON.stringify(signal));await page.screenshot({path:`${out}/${name}.png`});
      report.views.push({name,elapsedMs:performance.now()-started,sourceHash,surfaceHash,...state});await save();
    }
    // Real authoring range event path, held across multiple animation frames.
    await page.evaluate(()=>document.getElementById('burner-outerRadius-slider').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:19})));
    const radius=await page.$eval('#burner-outerRadius-slider',e=>Number(e.value));
    for(const offset of [.01,.02,.03]) {
      await page.$eval('#burner-outerRadius-slider',(e,value)=>{e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));},radius+offset);await settle();
      const state=await effective();assert.equal(state.lighting.geometryBuilds,original.lighting.geometryBuilds);assert.equal(state.lighting.previewStale,true);assert.match(state.badge,/previous geometry/);
      report.views.push({name:`editing-${offset}`,...state});await save();
    }
    await page.screenshot({path:`${out}/editing-preview.png`});
    await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:19})));
    await settle();const final=await effective();
    assert.equal(final.lighting.geometryBuilds,original.lighting.geometryBuilds+1);assert.equal(final.lighting.previewStale,false);assert.equal(final.badge,'');
    assert.deepEqual(final.lighting.frame.angularCache.counts,[12]);assert.equal(final.volume.error,null);
    report.views.push({name:'committed-edit',...final});await page.screenshot({path:`${out}/committed-edit.png`});await save();
  }
  const faviconOnly=report.httpFailures.length>0&&report.httpFailures.every(r=>new URL(r.url).pathname==='/favicon.ico');
  const materialErrors=report.errors.filter(e=>!(faviconOnly&&e.includes('Failed to load resource: the server responded with a status of 404')));
  assert.deepEqual(materialErrors,[]);
  report.status='captured';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;if(page)await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});}
finally{await save();await browser?.close();}
