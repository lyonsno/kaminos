import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {assertSourceGuideEvidence} from './beaming-surface-evidence.mjs';
const [url,out]=process.argv.slice(2),executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'source-preflight',requestedUrl:url,executable,source:{root:process.cwd(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'})},errors:[],httpFailures:[],views:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)),hash=v=>createHash('sha256').update(Buffer.from(new Float32Array(v).buffer)).digest('hex');
await save();let browser;
try{
 const params=new URLSearchParams(new URL(url).hash.slice(1)),sceneName=params.get('scene');assert(sceneName,'explicit authored target required');
 report.runtime=await(await fetch(new URL('/api/runtime-config',url))).json();
 assert.equal(report.runtime.source.repoRoot,report.source.root);assert.equal(report.runtime.source.commit,report.source.revision);assert.equal(report.source.dirty,'');assert.equal(report.runtime.source.dirty,false);
 const sceneResponse=await fetch(new URL('/api/read?root=scenes&path='+encodeURIComponent(sceneName),url));assert(sceneResponse.ok,'target scene not mounted');
 report.scene=await sceneResponse.json();assert.equal(report.scene.label,'importance-sampling-target-practice');assert.equal(new URL(url).searchParams.get('preset'),report.scene.composition.flame.presetId);
 assert.equal(report.scene.postprocessing.sceneGI.gain,10);assert((await fetch(new URL(report.scene.model.source,url))).ok,'actual kiln mesh missing');
 const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');await fs.access(executable);
 browser=await chromium.launch({headless:true,executablePath:executable,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const page=await browser.newPage({viewport:{width:1600,height:1200}});page.setDefaultTimeout(0);
 let fail;const broken=new Promise((_,reject)=>{fail=reject;});broken.catch(()=>{});
 page.on('pageerror',e=>{report.errors.push(String(e));fail(e);void save();});
 page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico')){report.errors.push(m.text());fail(Error(m.text()));void save();}});
 page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico')){report.httpFailures.push({url:r.url(),status:r.status()});fail(Error('required resource failed '+r.url()));void save();}});
 await page.route('**/scene-volume-gather.mjs',async route=>{const response=await route.fetch(),original=await response.text(),needle='  const resources=[];';assert.equal(original.split(needle).length,2);const body="import {installGatherProfiler} from './scratch/beaming-gather-profiler.mjs';\n"+original.replace(needle,needle+' installGatherProfiler(device);');report.gatherInstrumentation={original,body};await save();await route.fulfill({response,body});});
 await page.goto(new URL('/api/runtime-config',url).href);report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,architecture:a.info.architecture,isFallbackAdapter:a.isFallbackAdapter};});assert.equal(report.adapter.vendor,'apple');assert.equal(report.adapter.isFallbackAdapter,false);
 report.phase='registered-scene-load';await save();await page.goto(url);
 await Promise.race([page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().error||window.__kaminosSceneRadianceSetup?.status==='failed'||window.__kaminosSceneRadiance?.canRender()&&window.__kaminosVolumePrototype.debugState().frameCount>=120,null,{timeout:0}),broken]);
 const initial=await page.evaluate(()=>({url:location.href,lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),gi:window.kaminosSceneGIDebugState(),objects:window.kaminosSceneObjectDebugState()}));report.initial=initial;assert.equal(initial.volume.error,null);assert.equal(initial.gi.gain,10);assert.equal(initial.gi.effectiveMode,'combined');assert(initial.objects.some(o=>o.id==='kiln'));
 // Capture the requested URL's effective sampling controls before altering them.
 assert.equal(initial.lighting.frame.angularPattern,params.get('rendering_angular_pattern'));assert.equal(initial.lighting.frame.directions,Number(params.get('rendering_directions')));
 await page.evaluate(()=>{window.setGizmoMode?.(null);window.__kaminosVolumePrototype.setSimulationPaused(true);window.kaminosWorkspace.setMode('workbench');window.__kaminosSetActiveTab('assets');});
 await page.click('#right-tab-rendering');await page.selectOption('#rendering-light-mode','shared');await page.check('#rendering-retain-comparisons');await page.check('#rendering-match-flame-camera');await page.check('#rendering-surface-scattering');await page.selectOption('#rendering-receiver-spacing','0');
 await page.evaluate(gain=>{for(const[id,value]of [['rendering-shared-gain',gain],['rendering-surface-gain',0],['rendering-source-softness',0],['rendering-surface-reconstruction',0]]){const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}));}},report.scene.composition.lightGainStops);
 report.phase='held-source-pattern-comparison';await save();let heldHash,baseline,geometryBuilds;
 for(const [pattern,count]of [['source',12],['source',96],['guided',12],['guided',8],['guided',96],['source',12]]){
  await page.evaluate(()=>window.__kaminosVolumePrototype.setSelectiveHeadLiveCapturePaused(false));
  const started=performance.now();await page.selectOption('#rendering-angular-pattern',pattern);await page.selectOption('#rendering-angular-samples',String(count));
  await Promise.race([page.waitForFunction(({pattern,count})=>{const d=window.__kaminosSceneRadiance.debugState();return d.frame?.angularPattern===pattern&&d.frame?.directions===count&&!d.previewStale&&window.__kaminosSceneRadiance.canRender();},{pattern,count},{timeout:0}),broken]);
  const prepareElapsedMs=performance.now()-started;
  let profile={status:'unsupported'};
  if(await page.evaluate(()=>window.__beamingGatherDevice?.features.has('timestamp-query'))){await page.evaluate(()=>{window.__beamingGatherProfile={remaining:20,records:[],errors:[]};});await Promise.race([page.waitForFunction(()=>window.__beamingGatherProfile.errors.length||window.__beamingGatherProfile.records.length===20,null,{timeout:0}),broken]);profile=await page.evaluate(()=>window.__beamingGatherProfile);assert.deepEqual(profile.errors,[]);profile.status='measured';}
  await page.evaluate(()=>window.__kaminosVolumePrototype.setSelectiveHeadLiveCapturePaused(true));
  const capture=await page.evaluate(async()=>{const [fields,source]=await Promise.all([window.__kaminosSceneRadiance.readback(),window.__kaminosVolumePrototype.sampleSceneVolumeSource()]);return {lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),gi:window.kaminosSceneGIDebugState(),sourceGeneration:source.generation,sourceMetadata:{...source,values:undefined},primary:source.values,front:Array.from(fields.surface.data),back:Array.from(fields.surfaceBack.data),smoke:Array.from(fields.smoke.data),dimensions:{front:fields.surface.dimensions,back:fields.surfaceBack.dimensions,smoke:fields.smoke.dimensions}};});
  assertSourceGuideEvidence({...capture,runtime:report.runtime,source:report.source,adapter:report.adapter,errors:report.errors,httpFailures:report.httpFailures},{pattern,count,gain:2**report.scene.composition.lightGainStops,spacing:0});assert.equal(capture.volume.error,null);assert.equal(capture.gi.gain,10);
  const sourceHash=hash(capture.primary);if(heldHash)assert.equal(sourceHash,heldHash,'all comparisons must share complete primary source');else{heldHash=sourceHash;geometryBuilds=capture.lighting.geometryBuilds;}
  assert.equal(capture.lighting.geometryBuilds,geometryBuilds,'sampling changes must retain rendered/caster layout');
  const hashes={source:sourceHash,front:hash(capture.front),back:hash(capture.back),smoke:hash(capture.smoke)};
  if(pattern==='source'&&count===12){if(baseline)assert.deepEqual(hashes,baseline,'restoring source12 restores all actual fields');else baseline=hashes;}
  const name=`arm-${report.views.length}-${pattern}-${count}`;
  for(const[field,values]of [['source',capture.primary],['front',capture.front],['back',capture.back],['smoke',capture.smoke]])await fs.writeFile(`${out}/${name}-${field}.f32`,Buffer.from(new Float32Array(values).buffer));
  const canvas=page.locator('canvas').first(),rect=await canvas.boundingBox();
  // Select a left-wall region; a failed selection is retained, never success.
  const inspection=await page.evaluate(async({x,y})=>window.__kaminosLightingDebug.captureAt(x,y),{x:rect.x+rect.width*.42,y:rect.y+rect.height*.55});
  await fs.writeFile(`${out}/${name}-inspection.json`,JSON.stringify(inspection));
  if(inspection.status==='captured')assert.equal(inspection.replay.status,'matched','actual chosen receiver calculation must replay');
  await page.screenshot({path:`${out}/${name}.png`});
  report.views.push({name,pattern,count,hashes,prepareElapsedMs,profile,lighting:capture.lighting,volume:capture.volume,gi:capture.gi,sourceMetadata:capture.sourceMetadata,dimensions:capture.dimensions,inspection:{status:inspection.status,phase:inspection.phase,error:inspection.error,replay:inspection.replay?.status}});await save();
 }
 assert(report.views.some(v=>v.pattern==='guided'&&v.inspection.status==='captured'),'guided actual-input inspection must be exercised');
 report.status='captured';report.phase='complete';await save();
}catch(error){report.status='failed';report.error=String(error.stack||error);await save();process.exitCode=1;}
finally{await browser?.close();}
