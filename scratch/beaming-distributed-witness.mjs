import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
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
  page.on('response',r=>{if(r.status()>=400){report.httpFailures.push({url:r.url(),status:r.status()});void save();}});
  page.on('pageerror',e=>{report.errors.push(String(e));void save();});
  page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico')){report.errors.push(`${m.location().url}: ${m.text()}`);void save();}});
  await page.goto(new URL('/api/runtime-config',url).href);
  report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {...a.info.toJSON?.(),vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,description:a.info.description,isFallbackAdapter:a.isFallbackAdapter};});
  assert.ok(!report.adapter.isFallbackAdapter&&!/swiftshader/i.test(JSON.stringify(report.adapter)),'software fallback cannot establish native performance');
  await save();
  await page.goto(url);
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().error
    ||window.__kaminosSceneRadianceSetup?.status==='failed'
    ||(window.kaminosSceneObjectDebugState?.().length>0&&window.__kaminosSceneRadiance?.canRender()&&window.__kaminosVolumePrototype.debugState().frameCount>=120),null,{timeout:0});
  report.observed=await page.evaluate(()=>({effectiveUrl:location.href,setup:window.__kaminosSceneRadianceSetup,
    lighting:window.__kaminosSceneRadiance?.debugState(),volume:window.__kaminosVolumePrototype?.debugState(),objects:window.kaminosSceneObjectDebugState?.()}));
  assert.equal(report.observed.setup.status,'mounted');
  assert.equal(report.observed.lighting.identity,'distributed-volume-direct-radiance-v0');
  assert.ok(report.observed.lighting.frame.surfaceReceivers>0);
  assert.ok(report.observed.objects.length>0);
  assert.equal(report.observed.volume.error,null);
  await page.evaluate(()=>{window.setGizmoMode?.(null);window.__kaminosVolumePrototype.setSimulationPaused(true);
    window.__kaminosSetSceneCameraFrame([3,2,9],[0,.7,0]);window.__kaminosSetActiveTab('assets');});
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
      assert.equal(view.lighting.frame.smokeReconstruction.identity,'geometry-visible-trilinear-v1');
      if(originalSource)assert.deepEqual(view.source.values,originalSource,'orientation comparison requires identical raw source coefficients');
      else originalSource=view.source.values;
      await page.screenshot({path:`${out}/orientation-${name}.png`});
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
  const faviconOnly=report.httpFailures.length>0&&report.httpFailures.every(r=>new URL(r.url).pathname==='/favicon.ico');
  const materialErrors=report.errors.filter(e=>!(faviconOnly&&e.includes('Failed to load resource: the server responded with a status of 404')));
  assert.deepEqual(materialErrors,[]);
  report.status='captured';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;if(page)await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});}
finally{await save();await browser?.close();}
