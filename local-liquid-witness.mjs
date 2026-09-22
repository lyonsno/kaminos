import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {verifyAuthoringServer} from './scene-authoring-witness-identity.mjs';
import {compositionRestoreUrl} from './scene-authoring.mjs';

const {values:args}=parseArgs({options:{manifest:{type:'string'},out:{type:'string'}}});
assert.ok(args.out && path.isAbsolute(args.out),'--out must be an absolute path');
await fs.mkdir(args.out,{recursive:true});
const report={status:'running',phase:'arguments',startedAt:new Date().toISOString(),root:process.cwd(),errors:[],console:[],frames:[]};
const save=()=>fs.writeFile(path.join(args.out,'report.json'),JSON.stringify(report,null,2));
await save();
let browser,context,page;
const route='kaminos/finger-fluid/local-analytic-host-frame-v0';
function assertFrame(state) {
  assert.equal(state.failure,null);assert.equal(state.registered,true);assert.equal(state.mounted,true);
  assert.equal(state.requestedRoute,route);assert.equal(state.effectiveRoute,route);assert.ok(state.frameCount>0);
  assert.equal(state.hostBackend,'WebGPUBackend');assert.match(JSON.stringify(state.adapter),/apple/i);
  assert.equal(state.solver.solver_backend,'webgpu_compute');assert.equal(state.solver.effectiveRendererMode,'screen_space_refraction');
  assert.equal(state.solver.effectivePresentationMode,'local_analytic_consumer');
  assert.equal(state.solver.fallbackReason,null);assert.equal(state.solver.presentationEvidence.nonParticleToyDrawCount,0);
  assert.equal(state.solver.hostFrameCompositionEvidence.effectiveRoute,route);
  assert.equal(state.solver.hostFrameCompositionEvidence.hostFrameId,state.lastFrame.frameId);
  assert.equal(state.solver.cameraEvidence.identity,state.lastFrame.cameraIdentity);
  assert.equal(state.lastFrame.submittedByHost,true);assert.equal(state.lastFrame.presentedByHost,true);
}
try {
  const manifest=JSON.parse(await fs.readFile(args.manifest,'utf8'));report.requested=manifest;
  report.phase='source-preflight';await save();
  report.source=await verifyAuthoringServer({origin:manifest.origin,repoRoot:process.cwd()});
  assert.equal(report.source.source.commit,manifest.sourceCommit,'source revision changed');
  assert.equal(report.source.source.dirty,false,'witness needs a frozen source');
  assert.equal(report.source.sceneStore,manifest.sceneStore,'wrong saved-state namespace');
  for(const file of ['local-liquid-host.mjs','local-liquid-setup.mjs','finger-fluid-webgpu-core.js','scene-edit-session.mjs','scene-parameter-tools.mjs']) {
    const response=await fetch(new URL(file,manifest.origin));assert.ok(response.ok);
    const raw=Buffer.from(await response.arrayBuffer()),local=await fs.readFile(file);
    assert.deepEqual(raw,local,`wrong source ${file}`);report.source.hashes[file]=createHash('sha256').update(raw).digest('hex');
  }
  report.phase='greenroom-admission';await save();
  const running=path.join(manifest.queueRoot,'running'),matches=[];
  for(const entry of await fs.readdir(running)) {
    const request=JSON.parse(await fs.readFile(path.join(running,entry,'request.json'),'utf8'));
    if(request.input_path===args.manifest)matches.push({jobId:entry,request,status:JSON.parse(await fs.readFile(path.join(running,entry,'status.json'),'utf8'))});
  }
  assert.equal(matches.length,1,'native FIFO running request must own this exact manifest');
  assert.equal(matches[0].request.output_dir,args.out);assert.match(matches[0].status.effective_route,/local-liquid-witness\.mjs/);
  report.admission=matches[0];report.phase='browser-start';await save();
  const {chromium}=await import(pathToFileURL(manifest.playwright));
  browser=await chromium.launch({executablePath:manifest.chrome,headless:false,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  context=await browser.newContext({viewport:manifest.viewport,deviceScaleFactor:1,recordVideo:{dir:path.join(args.out,'video')}});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=await context.newPage();report.browser=await browser.version();
  page.on('pageerror',error=>report.errors.push(error.stack || error.message));
  page.on('console',message=>report.console.push({type:message.type(),text:message.text()}));
  page.on('dialog',async dialog=>{report.errors.push(`Unexpected dialog: ${dialog.message()}`);await dialog.dismiss();});
  const state=()=>page.evaluate(()=>window.kaminosLocalLiquidState());
  async function waitFrame(count) {
    await page.waitForFunction(count=>{
      const s=window.kaminosLocalLiquidState?.();return s?.failure || s?.frameCount>=count;
    },count,{timeout:120000});
    const result=await state();assertFrame(result);return result;
  }
  async function shot(name) {
    const image=path.join(args.out,name+'.png');
    await page.screenshot({path:image});const observed=await state();assertFrame(observed);
    report.frames.push({name,image,state:observed,url:page.url()});await save();
  }
  report.phase='host-mount';report.url=new URL('/#authoring=1&local_liquid=1',manifest.origin).href;await save();
  await page.goto(report.url);report.initial=await waitFrame(120);
  console.log(JSON.stringify({effectiveRoute:report.initial.effectiveRoute,hostBackend:report.initial.hostBackend,adapter:report.initial.adapter,source:report.source.source}));
  // Observed-state falsifiers: a fallback, stale/partial frame or substituted
  // camera cannot be admitted by the same predicate used below.
  for(const mutate of [s=>s.effectiveRoute='fallback',s=>s.mounted=false,s=>s.frameCount=0,
    s=>s.hostBackend='WebGLBackend',s=>s.lastFrame.frameId='stale',s=>s.lastFrame.cameraIdentity='private-camera']) {
    const bad=structuredClone(report.initial);mutate(bad);assert.throws(()=>assertFrame(bad));
  }
  await shot('01-host-water');
  report.phase='native-source-edit';
  const x=page.locator('#local-liquid-x');await x.fill('0.65');await x.press('Enter');
  assert.equal((await state()).setup.source.x,.65);assert.equal((await state()).solver.liveInlets.inlets[0].origin[0],.65);
  const aperture=page.locator('#local-liquid-radius');await aperture.fill('0.12');await aperture.press('Enter');
  assert.ok(Math.abs((await state()).solver.liveInlets.inlets[0].radius-.12)<1e-12);
  await page.evaluate(()=>window.kaminosSceneEdits.undo());assert.equal((await state()).setup.source.radius,.08);
  await page.evaluate(()=>window.kaminosSceneEdits.undo());assert.equal((await state()).setup.source.x,-.35);
  await page.evaluate(()=>window.kaminosSceneEdits.redo());await page.evaluate(()=>window.kaminosSceneEdits.redo());
  await x.fill('-1.2');await x.press('Escape');assert.equal((await state()).setup.source.x,.65);
  await page.evaluate(()=>window.kaminosSetAuthoredParameter('liquid.rate',800));
  assert.equal((await state()).solver.liveInlets.inlets[0].effective.particleReleaseRate,800);
  await waitFrame((await state()).frameCount+120);await shot('02-source-edited');
  report.phase='camera';
  const beforeCamera=(await state()).solver.cameraEvidence;
  const viewport=await page.locator('#kaminos-host-renderer-canvas').boundingBox();
  await page.mouse.move(viewport.x+viewport.width*.6,viewport.y+viewport.height*.5);
  await page.mouse.down({button:'right'});await page.mouse.move(viewport.x+viewport.width*.6+80,viewport.y+viewport.height*.5+30,{steps:8});await page.mouse.up({button:'right'});
  await waitFrame((await state()).frameCount+3);
  const afterCamera=(await state()).solver.cameraEvidence;
  assert.equal(afterCamera.identity,beforeCamera.identity);assert.notDeepEqual(afterCamera.view,beforeCamera.view);
  await shot('03-camera-edited');
  report.phase='save-reopen';
  report.beforeSave=await state();const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/save-scene') && response.request().method()==='POST');
  assert.equal(await page.evaluate(()=>window.saveScene()),true);
  const savedReceipt=await(await responsePromise).json();report.savedReceipt=savedReceipt;
  const saved=await(await fetch(`${manifest.origin}/api/read?root=scenes&path=${encodeURIComponent(savedReceipt.saved)}`)).json();
  await fs.writeFile(path.join(args.out,'saved-scene.json'),JSON.stringify(saved,null,2));
  assert.deepEqual(saved.localLiquid,report.beforeSave.setup);assert.equal(saved.localLiquid.particleState,undefined);
  report.reopenUrl=compositionRestoreUrl(null,savedReceipt.saved,manifest.origin);await page.goto(report.reopenUrl);
  report.reopened=await waitFrame(120);assert.deepEqual(report.reopened.setup,saved.localLiquid);
  for(let i=0;i<3;i++)assert.ok(Math.abs(report.reopened.solver.cameraEvidence.position[i]-saved.camera.position[i])<1e-5*Math.max(1,Math.abs(saved.camera.position[i])));
  assert.equal(await page.evaluate(()=>window.kaminosSceneEdits.state().undoCount),0);
  await shot('04-reopened');
  report.phase='observed-cadence';
  report.cadence=await page.evaluate(async()=>{
    const start=performance.now(),before=window.kaminosLocalLiquidState().frameCount;
    const intervals=[];let previous=start;
    for(let i=0;i<60;i++)await new Promise(resolve=>requestAnimationFrame(now=>{intervals.push(now-previous);previous=now;resolve();}));
    const elapsed=performance.now()-start,after=window.kaminosLocalLiquidState().frameCount;
    return {elapsedMs:elapsed,renderedFrames:after-before,observedFramesPerSecond:(after-before)*1000/elapsed,intervals,
      meaning:'browser cadence while this witness records video; not isolated GPU timing'};
  });
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  const gpuErrors=report.console.filter(x=>x.type==='error');assert.deepEqual(gpuErrors,[],'console errors require inspection');
  report.status='passed';report.phase='complete';report.effectiveRoute=route;
} catch(error) {
  report.status='failed';report.failurePhase=report.phase;report.error=error.stack || String(error);process.exitCode=1;
  if(page) {
    report.lastObserved=await page.evaluate(()=>window.kaminosLocalLiquidState?.()).catch(()=>null);
    await page.screenshot({path:path.join(args.out,'failed.png')}).catch(()=>{});
  }
  console.error(report.error);
} finally {
  if(context)await context.tracing.stop({path:path.join(args.out,'trace.zip')}).catch(error=>{report.traceError=error.message;});
  await browser?.close().catch(error=>{report.closeError=error.message;});
  report.finishedAt=new Date().toISOString();await save();
}
