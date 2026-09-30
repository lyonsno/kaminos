import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '/private/tmp/beaming-smoke-deps-0926/node_modules/playwright/index.mjs';
const [url,out]=process.argv.slice(2);
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
await fs.mkdir(out,{recursive:true});
const report={requestedUrl:url,executable,status:'running',phase:'load',errors:[],httpFailures:[],views:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
await save();let browser,page;
try {
  report.runtime=await(await fetch(new URL('/api/runtime-config',url))).json();
  const scene=await fetch(new URL('/api/read?root=scenes&path=cheap-kiln-shared-source.kaminos.json',url));
  assert.ok(scene.ok,'authored kiln scene is not mounted');
  report.scene=await scene.json();
  assert.ok((await fetch(new URL(report.scene.model.source,url))).ok,'authored kiln mesh is not mounted');
  await fs.access(executable);
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
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
    return {surface:stats(fields.surface.data),smoke:stats(fields.smoke.data),source:stats(source.values),rawSource:source};
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
  const faviconOnly=report.httpFailures.length>0&&report.httpFailures.every(r=>new URL(r.url).pathname==='/favicon.ico');
  const materialErrors=report.errors.filter(e=>!(faviconOnly&&e.includes('Failed to load resource: the server responded with a status of 404')));
  assert.deepEqual(materialErrors,[]);
  report.status='captured';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;if(page)await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});}
finally{await save();await browser?.close();}
