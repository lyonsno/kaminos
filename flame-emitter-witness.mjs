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
function assertFrame(observed) {
  const {volume,emitter}=observed;
  assert.equal(volume.active,true);assert.equal(volume.error,null);assert.match(volume.backend,/WebGPU/);
  assert.ok(volume.frameCount>0);assert.ok(volume.simStepCount>0);
  assert.equal(volume.ordinarySceneDepth.effective,true);
  assert.equal(emitter.registered,true);assert.equal(emitter.effectiveMode,'analytic-fixed');
  assert.equal(emitter.domain,'fixed-world-aligned-volume');
  assert.equal(emitter.source.coordinateSpace,'volume-local');
  assert.deepEqual(emitter.source.origin,emitter.pose.position);
  assert.equal(volume.analyticEmitterFrameId,emitter.source.frameId);
  assert.equal(volume.analyticEmitterDispatchActive,true);
  assert.equal(observed.receipt.fallbackUsed,false);
}
function assertPose(actual,expected,label='pose') {
  for(const group of ['position','rotation','scale']) {
    assert.equal(actual?.[group]?.length,3,`${label}.${group} must be a 3-vector`);
    for(let axis=0;axis<3;axis++) assert.ok(Math.abs(actual[group][axis]-expected[group][axis])<1e-10,
      `${label}.${group}[${axis}] differs: ${actual[group][axis]} vs ${expected[group][axis]}`);
  }
}
try {
  const manifest=JSON.parse(await fs.readFile(args.manifest,'utf8'));report.requested=manifest;
  assert.equal(manifest.requestedRoute,'local-native-chrome-webgpu','witness requires its declared local Chrome/WebGPU route');
  report.phase='source-preflight';await save();
  report.source=await verifyAuthoringServer({origin:manifest.origin,repoRoot:process.cwd()});
  assert.equal(report.source.source.commit,manifest.sourceCommit,'source revision changed');
  assert.equal(report.source.source.dirty,false,'witness needs a frozen source');
  assert.equal(report.source.sceneStore,manifest.sceneStore,'wrong saved-state namespace');
  for(const file of ['scene-flame-emitter.mjs','volume-emitter-runtime.mjs','volume-core.js','scene-edit-session.mjs','scene-placement-tools.mjs','annular-burner.mjs']) {
    const response=await fetch(new URL(file,manifest.origin));assert.ok(response.ok);
    const raw=Buffer.from(await response.arrayBuffer());assert.deepEqual(raw,await fs.readFile(file),`wrong source ${file}`);
    report.source.hashes[file]=createHash('sha256').update(raw).digest('hex');
  }
  report.phase='browser-start';await save();
  const {chromium}=await import(pathToFileURL(manifest.playwright));
  browser=await chromium.launch({executablePath:manifest.chrome,headless:false,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  report.execution={requestedRoute:manifest.requestedRoute,effectiveExecutable:await fs.realpath(manifest.chrome),
    browserVersion:browser.version(),nodeVersion:process.version,rendererBackend:null};
  context=await browser.newContext({viewport:manifest.viewport,deviceScaleFactor:1,recordVideo:{dir:path.join(args.out,'video')}});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=await context.newPage();report.browser=await browser.version();
  page.on('pageerror',error=>report.errors.push(error.stack || error.message));
  page.on('console',message=>report.console.push({type:message.type(),text:message.text()}));
  page.on('dialog',async dialog=>{report.errors.push(`Unexpected dialog: ${dialog.message()}`);await dialog.dismiss();});
  const state=()=>page.evaluate(()=>({volume:window.__kaminosVolumePrototype.debugState(),emitter:window.kaminosFlameEmitterState(),
    receipt:window.__kaminosVolumeEmitterReceipt,history:window.kaminosSceneEdits.state(),timeOrigin:performance.timeOrigin}));
  async function waitFrame(count) {
    await page.waitForFunction(count=>{
      const s=window.__kaminosVolumePrototype?.debugState?.();return s?.error || (s?.simStepCount>0 && s?.frameCount>=count && window.kaminosFlameEmitterState?.().registered);
    },count,{timeout:120000});
    const result=await state();assertFrame(result);return result;
  }
  async function shot(name) {
    const image=path.join(args.out,name+'.png');
    await page.screenshot({path:image});const observed=await state();assertFrame(observed);
    const png=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(window.__kaminosVolumePrototype.canvasElement().toDataURL('image/png')))));
    const volumeImage=path.join(args.out,name+'-volume.png');await fs.writeFile(volumeImage,Buffer.from(png.split(',')[1],'base64'));
    report.frames.push({name,image,volumeImage,state:observed,url:page.url()});await save();
  }
  report.phase='host-mount';report.url=manifest.sceneUrl;await save();
  await page.goto(report.url);report.initial=await waitFrame(120);
  report.execution.rendererBackend=report.initial.volume.backend;
  console.log(JSON.stringify({backend:report.initial.volume.backend,source:report.source.source,emitter:report.initial.emitter}));
  for(const mutate of [s=>s.volume.backend='WebGL',s=>s.emitter.registered=false,s=>s.volume.simStepCount=0,
    s=>s.emitter.source.origin=[99,99,99],s=>s.volume.analyticEmitterFrameId='stale',s=>s.receipt.fallbackUsed=true]) {
    const bad=structuredClone(report.initial);mutate(bad);assert.throws(()=>assertFrame(bad));
  }
  await shot('01-before-move');
  report.phase='native-source-gesture';await save();
  await page.locator('[data-scene-object-id="flame-emitter"] .scene-object-meta').click();
  const viewport=await page.locator('#kaminos-host-renderer-canvas').boundingBox();
  await page.mouse.move(viewport.x+viewport.width*.7,viewport.y+viewport.height*.5);
  const before=await state(),original=before.emitter.pose;
  for(const key of ['g','x','0','.','3','Enter'])await page.keyboard.press(key);
  const moved=await state();assertFrame(moved);
  assert.ok(Math.abs(moved.emitter.pose.position[0]-original.position[0]-.3)<1e-9);
  assert.equal(moved.history.undoCount,before.history.undoCount+1,'one gesture must create one history entry');
  assert.equal(moved.volume.fluidStateResetCount,before.volume.fluidStateResetCount,'moving injection must preserve the evolving fluid');
  assert.notDeepEqual(moved.volume.analyticEmitterDispatchCellMin,before.volume.analyticEmitterDispatchCellMin,'the GPU injection dispatch must follow the source');
  report.move={before,after:moved};await shot('02-immediately-moved');
  await waitFrame(moved.volume.frameCount+30);await shot('03-plume-after-move');
  await page.locator('#kaminos-host-renderer-canvas').hover();await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('Meta+z');assertPose((await state()).emitter.pose,original,'undo pose');
  await page.keyboard.press('Meta+Shift+z');assertPose((await state()).emitter.pose,moved.emitter.pose,'redo pose');
  for(const key of ['g','x','0','.','2','Escape'])await page.keyboard.press(key);
  assertPose((await state()).emitter.pose,moved.emitter.pose,'cancel pose');
  for(const key of ['r','z','2','0','Enter'])await page.keyboard.press(key);
  for(const key of ['s','1','.','1','Enter'])await page.keyboard.press(key);
  report.aimed=await state();assertFrame(report.aimed);
  assert.ok(Math.abs(report.aimed.emitter.source.axis[0]+Math.sin(Math.PI/9))<1e-9);
  assert.ok(Math.abs(report.aimed.emitter.pose.scale[0]-1.1)<1e-9);
  assert.equal(report.aimed.volume.fluidStateResetCount,before.volume.fluidStateResetCount,'aim/scale/undo/cancel must preserve fluid state');
  report.invalidMove=await page.evaluate(()=>{
    const before=window.kaminosFlameEmitterState(),history=window.kaminosSceneEdits.state();let error;
    try{window.kaminosSetSceneObjectTransform('flame-emitter',{position:[99,0,0]});}catch(e){error=e.message;}
    return {before,after:window.kaminosFlameEmitterState(),historyBefore:history,historyAfter:window.kaminosSceneEdits.state(),error};
  });
  assert.match(report.invalidMove.error,/bounds/);assertPose(report.invalidMove.after.pose,report.invalidMove.before.pose,'rejected move pose');
  assert.deepEqual(report.invalidMove.historyAfter,report.invalidMove.historyBefore,'rejected source placement must not strand a transaction');
  await waitFrame(report.aimed.volume.frameCount+30);await shot('04-aimed');
  report.phase='save-reopen';await save();
  report.beforeSave=await state();const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/save-scene') && response.request().method()==='POST');
  assert.equal(await page.evaluate(()=>window.saveScene()),true);
  report.savedReceipt=await(await responsePromise).json();
  const saved=await(await fetch(`${manifest.origin}/api/read?root=scenes&path=${encodeURIComponent(report.savedReceipt.saved)}`)).json();
  await fs.writeFile(path.join(args.out,'saved-scene.json'),JSON.stringify(saved,null,2));
  assertPose(saved.objects.find(o=>o.id==='flame-emitter').transform,report.beforeSave.emitter.pose,'saved pose');
  report.reopenUrl=compositionRestoreUrl(saved.composition,report.savedReceipt.saved,manifest.origin);
  await page.goto('about:blank');await page.goto(report.reopenUrl);
  report.reopened=await waitFrame(120);assert.notEqual(report.reopened.timeOrigin,report.beforeSave.timeOrigin);
  assertPose(report.reopened.emitter.pose,report.beforeSave.emitter.pose,'reopened pose');
  assert.equal(report.reopened.history.undoCount,0);await shot('05-reopened');
  assert.deepEqual(report.errors,[],'page errors require inspection');
  assert.deepEqual(report.console.filter(x=>x.type==='error'),[],'console errors require inspection');
  report.status='passed';report.phase='complete';
} catch(error) {
  report.status='failed';report.failurePhase=report.phase;report.error=error.stack || String(error);process.exitCode=1;
  if(page) {
    report.lastObserved=await page.evaluate(()=>({volume:window.__kaminosVolumePrototype?.debugState?.(),emitter:window.kaminosFlameEmitterState?.()})).catch(()=>null);
    await page.screenshot({path:path.join(args.out,'failed.png')}).catch(()=>{});
  }
  console.error(report.error);
} finally {
  const cleanupErrors=[];
  if(context)await context.tracing.stop({path:path.join(args.out,'trace.zip')}).catch(error=>cleanupErrors.push(error.message));
  if(context)await context.close().catch(error=>cleanupErrors.push(error.message));
  await browser?.close().catch(error=>cleanupErrors.push(error.message));
  if(context) {
    try {
      assert.ok((await fs.stat(path.join(args.out,'trace.zip'))).size>0,'trace is empty');
      const videos=await fs.readdir(path.join(args.out,'video'));assert.ok(videos.length>0,'video missing');
      for(const video of videos)assert.ok((await fs.stat(path.join(args.out,'video',video))).size>0,'video is not flushed');
    }catch(error){cleanupErrors.push(error.message);}
  }
  if(cleanupErrors.length){report.cleanupErrors=cleanupErrors;report.status='failed';report.failurePhase ||= 'evidence-finalization';process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await save();
}
