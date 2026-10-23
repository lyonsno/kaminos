import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [origin,out]=process.argv.slice(2);
if(!origin||!out)throw Error('Usage: scene-burning-witness.mjs <origin> <output directory>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:path.resolve(import.meta.dirname,'..'),errors:[],observations:[]};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let browser,context;
try{
  await save();report.revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  report.executable=process.env.CHROME_EXECUTABLE;
  assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'));
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{executablePath:report.executable,headless:true,viewport:{width:1280,height:900},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
  browser=context.browser();const page=context.pages()[0];page.setDefaultTimeout(0);
  let reject;const failure=new Promise((_,fail)=>{reject=fail;});failure.catch(()=>{});
  const fail=error=>{report.errors.push(String(error));reject(Error(String(error)));};
  page.on('pageerror',fail);page.on('console',m=>{if(m.type()==='error')fail(m.text());});
  const guard=promise=>Promise.race([promise,failure]);
  await page.addInitScript(()=>{const error=console.error.bind(console);console.error=(...args)=>error(...args,new Error('Console error origin').stack);});
  report.url=origin+'/volume-settings-preset.html?preset=vsp-5d3c953814884ed597721350fde28d275a00af04a087d8bb5ec8127984c92bcc#workspace=workbench&volume_light_field=1&volume_light_field_scene_depth=1&volume_light_field_test_scene=0&volume_collision=kiln';
  report.phase='load';await save();await guard(page.goto(report.url));
  await guard(page.waitForFunction(()=>window.kaminosSceneAuthoring&&window.__kaminosVolumeEmitterReceipt&&window.__kaminosVolumePrototype?.debugState().active));
  report.phase='resident-coverage';await save();
  report.coverage=await guard(page.evaluate(async()=>{const {runResidentLightFixture}=await import('/tools/resident-light-fixture.mjs');return runResidentLightFixture();}));await save();
  page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().error).then(async handle=>fail(await handle.jsonValue())).catch(()=>{});
  report.phase='ordinary-objects';await save();
  report.ids=await guard(page.evaluate(async()=>{
    const api=window.kaminosSceneAuthoring,runtime=window.__kaminosVolumePrototype;
    runtime.setSimulationPaused(true);
    for(const [id,value] of [['scene-gi-steps','4'],['scene-gi-slices','3']]){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
    await api.addFlameEmitter('vsp-5d3c953814884ed597721350fde28d275a00af04a087d8bb5ec8127984c92bcc');
    runtime.setSimulationPaused(true);
    const ids=[api.addMesh('box',{width:.28,height:.35,depth:.28}),api.addMesh('box',{width:.28,height:.35,depth:.28})];
    ids.forEach((id,i)=>{window.kaminosSetSceneObjectTransform(id,{position:[i?.2:-.2,-.3,0]});api.setBurnable(id,true);api.setCollision(id,true);});
    window.kaminosSceneCollision.set(true);return ids;
  }));
  await guard(page.waitForFunction(ids=>ids.every(id=>window.kaminosSceneAuthoring.burningState(id).status==='resident'),report.ids));
  report.effective=await page.evaluate(()=>{const r=window.__kaminosVolumePrototype.debugState();return {backend:r.backend,grid:r.simGrid,rays:Number(document.getElementById('volume-steps').value),radius:Number(document.getElementById('volume-immersed-radius').value),gi:{steps:Number(document.getElementById('scene-gi-steps').value),slices:Number(document.getElementById('scene-gi-slices').value)},consumer:window.__kaminosVolumePrototype.thermalConsumerState()?.identity};});
  assert.deepEqual(report.effective.gi,{steps:4,slices:3});
  assert.match(report.effective.backend,/WebGPU/);assert.equal(report.effective.grid,32);assert.equal(report.effective.rays,28);assert.equal(report.effective.radius,.1);assert.equal(report.effective.consumer,'kaminos.scene-burning.v1');
  report.sources=[];
  for(const name of ['index.html','authoring-workspace.mjs','scene-burning.mjs','scene-burn-body.mjs','scene-burning-settings.mjs','scene-repetition.mjs','scene-persistence-core.js','live-log-indicator.mjs','scene-local-visibility.mjs','scene-bvh-reproject.mjs','live-log-heat-gpu.mjs','live-log-gas-source.mjs']){
    const local=await fs.readFile(path.join(report.repoRoot,name)),response=await page.request.get(origin+'/'+name);assert.equal(response.ok(),true);
    const served=await response.body(),hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(hash(local),hash(served));report.sources.push({name,sha256:hash(local)});
  }
  const sample=async name=>{
    const rows=await guard(page.evaluate(async ids=>Promise.all(ids.map(async id=>({id,state:window.kaminosSceneAuthoring.burningState(id),snapshot:window.kaminosSceneAuthoring.burningState(id).status==='resident'?await window.kaminosSceneAuthoring.burningSnapshot(id):null}))),report.ids));
    await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(rows));
    report.observations.push({name,rows:rows.map(({id,state,snapshot})=>({id,state,peakHeat:snapshot?Math.max(...snapshot.material.filter((_,i)=>i%8===0)):null}))});await save();return rows;
  };
  await sample('cold');await page.screenshot({path:path.join(out,'cold.png')});
  report.phase='shared-step';await save();
  const advance=async count=>guard(page.evaluate(async count=>{const r=window.__kaminosVolumePrototype,target=r.debugState().simStepCount+count;r.setSimulationPaused(false);r.setSelectiveHeadLiveCapturePaused(false);const result=await r.pauseSelectiveHeadLiveAtSimStep(target);r.setSimulationPaused(true);r.setSelectiveHeadLiveCapturePaused(false);return result;},count));
  assert.equal((await advance(120)).ok,true);const hot=await sample('hot');assert.ok(hot.every(row=>row.state.state.fields[0].steps>=120));
  await page.screenshot({path:path.join(out,'hot.png')});
  report.phase='disable-one';await save();
  await page.evaluate(ids=>{window.selectSceneObject(ids[0]);},report.ids);
  report.control=await page.locator('#object-burnable').evaluate(el=>({checked:el.checked,html:el.outerHTML,ancestors:[...function*(node){for(;node;node=node.parentElement)yield node;}(el)].map(n=>({tag:n.tagName,id:n.id,hidden:n.hidden,display:getComputedStyle(n).display}))}));await save();
  assert.equal(await page.locator('#object-burnable').isVisible(),true,'Selected ordinary mesh has a visible burnable control');
  await page.locator('#object-burnable').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'control.png')});
  await page.locator('#object-burnable').uncheck();
  await guard(page.waitForFunction(id=>window.kaminosSceneAuthoring.burningState(id).status==='off',report.ids[0]));
  const before=await sample('one-disabled');assert.equal(before[1].state.state.fields[0].steps,hot[1].state.state.fields[0].steps);
  assert.equal((await advance(60)).ok,true);const after=await sample('other-continues');assert.equal(after[1].state.state.fields[0].steps,before[1].state.state.fields[0].steps+60);
  report.phase='undo-disable';await save();await page.evaluate(()=>window.kaminosSceneEdits.undo());
  await guard(page.waitForFunction(id=>window.kaminosSceneAuthoring.burningState(id).status==='resident',report.ids[0]));
  const restored=await sample('undo');assert.equal(restored[1].state.state.fields[0].steps,after[1].state.state.fields[0].steps);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png')});
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await context?.close();await save();}
