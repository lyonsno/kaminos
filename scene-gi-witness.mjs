import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {admitSceneGIComparison} from './scene-gi-evidence.mjs';
const [url,out,root,operation] = process.argv.slice(2);
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
await fs.mkdir(out,{recursive:true});
const report={requestedUrl:url,expectedRoot:root,executable,status:'running',phase:'load',errors:[],httpErrors:[],views:[]};
const save=()=>fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
await save();let browser,page;
try {
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  report.runtime=await(await fetch(new URL('/api/runtime-config',url))).json();
  assert.equal(report.runtime.source.repoRoot,root);
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(0);
  page.on('pageerror',e=>{report.errors.push(String(e));void save();});
  page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:')){report.errors.push(m.text());void save();}});
  page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).pathname!=='/favicon.ico'){report.httpErrors.push({url:r.url(),status:r.status()});void save();}});
  await page.goto(new URL('/api/runtime-config',url).href);
  report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,architecture:a.info.architecture,device:a.info.device,isFallbackAdapter:a.isFallbackAdapter};});
  assert.ok(!report.adapter.isFallbackAdapter&&!/swiftshader/i.test(JSON.stringify(report.adapter)));
  await page.goto(url);
  await page.waitForFunction(()=>window.__kaminosSceneRadianceSetup?.status==='failed'||window.__kaminosVolumePrototype?.debugState().error||(window.kaminosSceneObjectDebugState?.().length>0&&window.__kaminosSceneRadiance?.canRender()&&window.__kaminosVolumePrototype.debugState().frameCount>=120),null,{timeout:0});
  await page.evaluate(()=>{window.setGizmoMode?.(null);window.__kaminosVolumePrototype.setSimulationPaused(true);window.__kaminosSetSceneCameraFrame([3,2,9],[0,.7,0]);window.__kaminosSetActiveTab('assets');document.getElementById('right-tab-rendering').click();});
  if(operation==='--composition') {
    await page.selectOption('#rendering-light-mode','shared');
    await page.selectOption('#rendering-angular-samples','12');
    await page.selectOption('#rendering-angular-pattern','source');
    await page.check('#rendering-surface-scattering');
    await page.waitForTimeout(1000);
  }
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
    const regions=[{name:'full',start:0,end:lit.length},{name:'bottom-central-floor-strip',start:Math.floor(fields.lit.height*.8)*fields.lit.width*4,end:lit.length}];
    report.linearComposition={aoEnabled:false,width:fields.lit.width,height:fields.lit.height,regions:[]};
    for(const region of regions) {
      let added=0,expected=0,error=0,maxError=0;
      for(let i=region.start;i<region.end;i++)if(i%4<3) {
        if(region.name!=='full') {const x=Math.floor(i/4)%fields.lit.width;if(x<fields.lit.width*.25||x>=fields.lit.width*.75)continue;}
        const difference=lit[i]-zero[i],e=Math.abs(difference-received[i]);
        added+=difference;expected+=received[i];error+=e;maxError=Math.max(maxError,e);
      }
      report.linearComposition.regions.push({...region,added,expected,error,maxError,relativeError:error/expected});
      await save();
      assert.ok(expected>0,'received bounce must reach the measured region');
      assert.ok(error/expected<.05,'received field must agree with linear scene addition');
    }
    await page.check('#ao-toggle');
    await page.selectOption('#scene-gi-view','scene');
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
  report.runtimeAfter=await(await fetch(new URL('/api/runtime-config',url))).json();
  assert.deepEqual(report.runtimeAfter.source,report.runtime.source,'source revision changed during witness');
  report.status='captured';report.phase='complete';
} catch(e) {report.status='failed';report.error=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});}
finally {await save();await browser?.close();}
