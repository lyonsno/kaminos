import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [url,out,executablePath]=process.argv.slice(2);
const cuePhase=process.argv[5] || 'work';
const boundaries=process.argv[6]==='boundaries';
if(!url||!out||!executablePath)throw Error('URL, output directory and independent browser required');
await fs.mkdir(out,{recursive:true});
const report={requestedUrl:url,executablePath,cuePhase,boundaries,status:'running',phase:'launch',errors:[],frames:[],sourceHashes:{}};
let browser,page;
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const screenshot=async name=>{await page.screenshot({path:path.join(out,name)});report.frames.push(name);await save();};
const pixels=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{
  const source=document.getElementById('kaminos-host-renderer-canvas');
  if(!source)return resolve({nonblack:0});
  const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  const context=canvas.getContext('2d');context.drawImage(source,0,0);
  const data=context.getImageData(0,0,canvas.width,canvas.height).data;
  let nonblack=0;for(let i=0;i<data.length;i+=4)if(data[i+3]&&data[i]+data[i+1]+data[i+2])nonblack++;
  resolve({width:canvas.width,height:canvas.height,nonblack});
})));
const snapshot=()=>page.evaluate(async()=>({route:window.__kaminosCompositionSetup,workspace:window.kaminosWorkspace.state(),
  ranges:(await import('./kiln-cue-tunes.mjs')).captureCueControlRanges(document),
  ordinaryFlowMaximum:document.getElementById('selected-volume-flow-rate')?.max,
  cinematic:window.kaminosCinematic.state(),cues:window.kaminosCinematic.read(),
  tune:window.kaminosFlameAuthoring.read(),history:window.kaminosSceneEdits.state(),
  editor:window.kaminosCinematic.cueEditor?.state(),status:document.getElementById('cue-status')?.textContent,
  frame:window.__kaminosVolumePrototype.debugState().frameCount,objects:window.kaminosSceneObjectDebugState()}));
try {
  report.phase='configuration';
  if(!['ignition','work'].includes(cuePhase))throw Error('Unknown cue phase');
  if(new URLSearchParams(new URL(url).hash.slice(1)).get('composition_module_url')!=='./kiln-cinematic.mjs')throw Error('Requested route does not name the cinematic composition');
  if(!/Chrome for Testing|chromium|headless_shell/i.test(executablePath))throw Error('Independent browser required');
  const {chromium}=await import('/Users/noahlyons/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  browser=await chromium.launch({headless:true,executablePath});report.browserVersion=browser.version();
  page=await browser.newPage({viewport:{width:1500,height:1050}});
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)report.errors.push(`${response.status()} ${response.url()}`);});
  report.phase='load';await save();await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.kaminosCinematic?.state().armed && window.__kaminosVolumePrototype?.debugState().frameCount>15);
  report.effectiveUrl=page.url();report.loaded=await snapshot();assert.equal(report.loaded.route.status,'mounted');
  assert.match(report.loaded.objects.find(object=>object.id==='kiln')?.source||'',/f8e6ce918e3e5cf234d186724dc21b40b3f9cf7cbc9e776000cf55f24801c91b/);
  report.loadedPixels=await pixels();assert.ok(report.loadedPixels.nonblack>0);
  for(const name of ['index.html','kiln-cinematic.mjs','kiln-cinematic-cues.mjs','kiln-cue-tunes.mjs','kiln-cue-editor.mjs','kiln-cue-workspace.mjs','flame-tune-panel.mjs','authoring-workspace.mjs']) {
    const local=await fs.readFile(new URL(name,import.meta.url));
    const response=await fetch(`${new URL(url).origin}/${name}`);assert.equal(response.ok,true);
    const served=Buffer.from(await response.arrayBuffer());
    const hash=value=>createHash('sha256').update(value).digest('hex');
    assert.equal(hash(local),hash(served));report.sourceHashes[name]=hash(served);
  }
  await page.click('#kiln-edit');await page.click(`[data-cue-phase="${cuePhase}"]`);
  report.phase='keyframe-edit';report.before=await snapshot();await screenshot('cue-workspace.png');
  await page.locator('#cue-key-list button').nth(1).click();
  const exposure=page.getByLabel('Cue Exposure',{exact:true}).first();
  const current=await exposure.inputValue();const value=Number(current)+.4;
  await exposure.click();await exposure.fill(String(value));await exposure.press('Enter');
  report.draft=await snapshot();assert.ok(Math.abs(Number(report.draft.tune.domControls['volume-physical-exposure'].value)-value)<1e-12);
  await screenshot('tuning-key.png');await page.click('#cue-accept');
  report.accepted=await snapshot();
  assert.equal(Number(report.accepted.cues[cuePhase][1].tune.domControls['volume-physical-exposure'].value),value);
  assert.deepEqual(report.accepted.tune,report.before.tune);
  assert.deepEqual(report.accepted.ranges,report.before.ranges);assert.equal(report.accepted.ordinaryFlowMaximum,report.before.ordinaryFlowMaximum);
  assert.equal(report.accepted.history.undoCount,report.before.history.undoCount+1);
  await page.evaluate(()=>window.kaminosSceneEdits.undo());report.undone=await snapshot();assert.deepEqual(report.undone.cues,report.before.cues);
  await page.evaluate(()=>window.kaminosSceneEdits.redo());report.redone=await snapshot();assert.deepEqual(report.redone.cues,report.accepted.cues);
  await page.locator('#cue-key-list button').nth(1).click();await exposure.click();await exposure.fill(String(value+.3));await page.click('#cue-cancel');
  report.cancelled=await snapshot();assert.deepEqual(report.cancelled.cues,report.accepted.cues);assert.deepEqual(report.cancelled.tune,report.before.tune);
  assert.deepEqual(report.cancelled.ranges,report.before.ranges);
  report.phase='relative-drag';
  const box=await exposure.boundingBox(),startValue=Number(await exposure.inputValue());
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2,{steps:5});await page.mouse.up();
  report.dragged=await snapshot();
  assert.ok(Math.abs(Number(report.dragged.editor.tune.domControls['volume-physical-exposure'].value)-startValue-.2)<1e-9);
  await page.click('#cue-cancel');
  report.phase='basin-draft';
  await page.locator('#cue-basin-browser summary').click();
  const basin=report.before.tune.source.presetId;
  await page.selectOption('#cue-basin-select',basin);await page.click('#cue-basin-apply');
  await page.waitForFunction(id=>window.kaminosCinematic.cueEditor.state()?.tune.source.presetId===id,basin);
  report.basinDraft=await snapshot();await page.click('#cue-cancel');assert.deepEqual((await snapshot()).cues,report.accepted.cues);
  await page.click('#cue-duplicate');report.duplicated=await snapshot();assert.equal(report.duplicated.cues[cuePhase].length,report.before.cues[cuePhase].length+1);
  await page.click('#cue-remove');assert.deepEqual((await snapshot()).cues,report.accepted.cues);
  report.phase='save';report.saved=await page.evaluate(()=>window.saveSceneAs({result:true}));assert.equal(report.saved.ok,true,report.saved.error);
  assert.deepEqual(report.saved.document.cinematic,report.accepted.cues);await screenshot('accepted-keyframe.png');
  await page.goto(report.saved.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.kaminosCinematic?.state().armed);
  report.reopened=await snapshot();assert.deepEqual(report.reopened.cues,report.accepted.cues);
  await page.click('#kiln-edit');await page.click(`[data-cue-phase="${cuePhase}"]`);await screenshot('reopened-cues.png');
  report.phase='performance';await page.click('#cue-preview');
  if(cuePhase==='ignition') {
    await page.waitForFunction(()=>window.kaminosCinematic.state().phase==='ignition');
    await page.waitForTimeout(1200);report.ignition=await snapshot();
    assert.equal(report.ignition.cinematic.phase,'ignition');assert.equal(report.ignition.cinematic.failure,null);
    assert.ok(Math.abs(Number(report.ignition.tune.domControls['volume-physical-exposure'].value)-Number(report.ignition.cinematic.effective.tune.domControls['volume-physical-exposure'].value))<1e-12);
    await screenshot('tuned-ignition.png');
  }
  await page.waitForFunction(()=>['work','failed'].includes(window.kaminosCinematic.state().phase));
  report.work=await snapshot();assert.equal(report.work.cinematic.failure,null);
  assert.ok(Math.abs(Number(report.work.tune.domControls['volume-physical-exposure'].value)-Number(report.work.cinematic.effective.tune.domControls['volume-physical-exposure'].value))<1e-12);
  await screenshot('tuned-performance.png');
  await page.waitForFunction(()=>['complete','failed'].includes(window.kaminosCinematic.state().phase));
  report.complete=await snapshot();assert.equal(report.complete.cinematic.phase,'complete');assert.equal(report.complete.cinematic.effective.sourceEnabled,false);
  assert.equal(report.complete.cinematic.effective.outputVisible,true);assert.ok(report.complete.frame>report.work.frame);
  await screenshot('reveal.png');await page.click('#kiln-edit');report.restored=await snapshot();assert.deepEqual(report.restored.tune,report.before.tune);
  assert.deepEqual(report.restored.ranges,report.before.ranges);
  report.performancePixels=await pixels();assert.ok(report.performancePixels.nonblack>0);
  await page.setViewportSize({width:390,height:844});await screenshot('mobile-cues.png');
  if(boundaries) {
    await page.setViewportSize({width:1500,height:1050});
    report.phase='workspace-departure';report.departures=[];
    for(const selector of ['[data-workspace-mode="workbench"]','[data-workbench-tab="assets"]','[data-workbench-tab="generate"]']) {
      await page.locator('#cue-key-list button').nth(1).click();await exposure.click();await exposure.fill(String(value+.2));
      assert.equal(await page.evaluate(()=>window.kaminosCinematic.cueEditor.active()),true);
      const history=await page.evaluate(()=>window.kaminosSceneEdits.state());
      await page.click(`#authoring-header ${selector}`);
      const departed=await snapshot();assert.equal(departed.workspace.mode,'workbench');assert.equal(departed.editor,null);
      assert.deepEqual(departed.tune,report.before.tune);assert.equal(departed.history.undoCount,history.undoCount);
      assert.deepEqual(departed.ranges,report.before.ranges);assert.equal(departed.ordinaryFlowMaximum,report.before.ordinaryFlowMaximum);
      report.departures.push({selector,state:departed});
      await page.click('#authoring-header [data-workspace-mode="authoring"]');
      await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().active);
    }
    report.phase='legacy-flow';
    const legacy=await page.evaluate(()=>{
      const recipe=window.kaminosCinematic.read();
      for(const [i,key] of recipe.work.entries()){key.flow=i===0?3:4;delete key.tune;}
      window.kaminosCinematic.write(recipe);return recipe;
    });
    report.legacyRequested=legacy;
    report.legacySaved=await page.evaluate(()=>window.saveSceneAs({result:true}));assert.equal(report.legacySaved.ok,true,report.legacySaved.error);
    assert.deepEqual(report.legacySaved.document.cinematic.work.map(key=>key.flow),[3,4,4]);
    await page.goto(report.legacySaved.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.kaminosCinematic?.state().armed);
    assert.deepEqual((await snapshot()).cues.work.map(key=>key.flow),[3,4,4]);
    await page.click('#kiln-edit');await page.click('[data-cue-phase="work"]');
    report.legacyDrafts=[];
    for(const [i,flow] of [[0,3],[1,4]]) {
      await page.locator('#cue-key-list button').nth(i).click();const state=await snapshot();
      assert.equal(state.editor.tune.domControls['volume-flow-rate'].value,flow);
      assert.equal(Number(await page.getByLabel('Cue Flow',{exact:true}).inputValue()),flow);
      await page.getByLabel('Cue Flow',{exact:true}).click();await page.getByLabel('Cue Flow',{exact:true}).fill(String(flow-.1));
      assert.ok(Math.abs((await snapshot()).tune.domControls['volume-flow-rate'].value-flow+.1)<1e-12);
      await page.click('#cue-cancel');report.legacyDrafts.push({flow,state});
    }
    await page.click('#cue-preview');await page.waitForFunction(()=>window.kaminosCinematic.state().phase==='work'&&window.kaminosCinematic.state().effective.flow===4);
    report.legacyWork=await snapshot();report.legacyEmitter=await page.evaluate(()=>window.__kaminosVolumeEmitterReceipt);
    assert.equal(report.legacyWork.tune.domControls['volume-flow-rate'].value,4);
    assert.equal(report.legacyEmitter.compilerReceipt.effective.strength,4);await screenshot('legacy-flow4.png');
    await page.waitForFunction(()=>['complete','failed'].includes(window.kaminosCinematic.state().phase));
    assert.equal((await snapshot()).cinematic.phase,'complete');await page.click('#kiln-edit');report.legacyRestored=await snapshot();assert.deepEqual(report.legacyRestored.tune,report.before.tune);
    assert.deepEqual(report.legacyRestored.ranges,report.before.ranges);assert.equal(report.legacyRestored.ordinaryFlowMaximum,report.before.ordinaryFlowMaximum);
    report.ordinaryAdmission=await page.evaluate(()=>{
      const snapshot=window.kaminosFlameAuthoring.read();snapshot.domControls['volume-flow-rate'].value=3;
      try {window.kaminosFlameAuthoring.apply(snapshot);return {admitted:true};}catch(error){return {admitted:false,error:error.message};}
    });
    assert.equal(report.ordinaryAdmission.admitted,false);assert.match(report.ordinaryAdmission.error,/Out of range volume-flow-rate/);
  }
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
} catch(error) {
  report.status='failed';report.error=error.stack||String(error);
  if(page){try{report.lastState=await snapshot();await screenshot('failure.png');}catch(capture){report.captureError=String(capture);}}
  process.exitCode=1;
} finally {await save();await browser?.close();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:path.join(out,'report.json')}));
