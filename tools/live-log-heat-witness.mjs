import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BURN_TABLE_ASSET} from '../burn-table-core.mjs';
import {startWitnessServer} from './witness-server.mjs';
const output=process.argv[2];
if(!output)throw Error('An explicit output path is required');
await fs.mkdir(output,{recursive:true});
const mode=process.env.LIVE_LOG_WITNESS_MODE||'full';
const report={status:'starting',phase:'preflight',mode,scope:mode==='initial'?'cold-and-initial-heat-only':'heating-movement-cooling-reset',repoRoot:path.resolve(import.meta.dirname,'..'),requestedUrl:process.env.KAMINOS_URL,url:process.env.KAMINOS_URL,executable:process.env.CHROME_EXECUTABLE,errors:[],frames:[],claim:'runtime/route conformance only; image interpretation remains required'};
const save=()=>fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
let browser,page,server,primaryError=null;
try {
  await save();if(!['full','initial'].includes(mode))throw Error('Unknown live-log witness mode: '+mode);
  assert.ok((report.url||process.env.LIVE_LOG_SELF_HOST==='1')&&report.executable&&process.env.PLAYWRIGHT_MODULE,'KAMINOS_URL, CHROME_EXECUTABLE and PLAYWRIGHT_MODULE required');
  assert.ok(!report.executable.includes('/Applications/Google Chrome.app/'),'Independent browser required');
  if(process.env.LIVE_LOG_SELF_HOST==='1'){
    report.phase='server-launch';await save();server=await startWitnessServer({repoRoot:report.repoRoot,output,requestedUrl:report.url,python:process.env.PYTHON_EXECUTABLE||'python3'});
    report.server=server.evidence;report.url=server.url;await save();
  }
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(0);
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  report.phase='load';await page.goto(report.url);
  await page.waitForFunction(()=>['mounted','failed'].includes(window.kaminosLiveLogEntry?.status));
  report.entry=await page.evaluate(()=>window.kaminosLiveLogEntry);assert.equal(report.entry.status,'mounted',report.entry.error);
  report.effectiveUrl=page.url();report.sources=[];
  for(const name of ['index.html','volume-core.js','burn-table-material.mjs','burn-table.css','basin-fire-fixture.mjs','flame-authoring.mjs','scene-persistence-core.js','live-log-heat-core.mjs','live-log-heat-gpu.mjs','live-log-experiment.mjs','experiments/sinter/live-log-heat.experiment.mjs','workbench-experiments.mjs','serve.py','tools/live-log-heat-witness.mjs','tools/witness-server.mjs']){
    const response=await page.request.get(new URL(name,report.url).href);assert.equal(response.status(),200);
    const actual=createHash('sha256').update(await response.body()).digest('hex');const expected=createHash('sha256').update(await fs.readFile(path.join(report.repoRoot,name))).digest('hex');
    assert.equal(actual,expected,'Served source mismatch '+name);report.sources.push({name,sha256:actual});
  }
  const cold=await page.evaluate(()=>window.kaminosLiveLog.read());report.cold=cold;
  assert.equal(cold.status,'cold');assert.equal(cold.paused,true);assert.equal(cold.burner,false);assert.equal(cold.fluid.active,true);
  assert.match(cold.fluid.backend,/WebGPU/);assert.ok(cold.fields.length);assert.ok(cold.fields.every(f=>f.steps===0&&f.runtimeReadbacks===0));assert.equal(cold.asset.sha256,BURN_TABLE_ASSET.sha256);
  const resource=await page.request.get(new URL(cold.source,report.url).href);report.assetSha256=createHash('sha256').update(await resource.body()).digest('hex');assert.equal(report.assetSha256,BURN_TABLE_ASSET.sha256);
  const shot=async name=>{
    await page.evaluate(()=>window.__kaminosRenderSceneForInspection());
    const state=await page.evaluate(()=>window.kaminosLiveLog.read());
    const material=await page.evaluate(()=>document.getElementById('kaminos-host-renderer-canvas').toDataURL('image/png'));
    await fs.writeFile(path.join(output,name+'-material.png'),Buffer.from(material.split(',')[1],'base64'));
    await page.screenshot({path:path.join(output,name+'.png')});report.frames.push({name,state});await save();
  };
  await shot('cold');
  if(cold.fire){
    report.phase='fire-inspector';await page.locator('#live-log-heat [data-action=selectFire]').click();await shot('fire-inspector');
    await page.locator('#selected-flame-properties [data-library]').click();
    await page.locator('.basin-fire-library-row').first().waitFor();
    await page.locator('.basin-fire-library-row').filter({hasText:'cheap-blast-furnace-beaming-lightweight-smoke'}).first().click();
    await page.waitForFunction(()=>document.querySelector('.basin-fire-library [data-selection]')?.textContent.includes('Grid 48'));
    await page.screenshot({path:path.join(output,'basin-library.png')});
    await page.locator('.basin-fire-library [data-close]').click();
    await page.evaluate(()=>window.kaminosLiveLog.invoke('move',{position:[.5,-.35,0]}));
    report.placed=await page.evaluate(()=>window.kaminosLiveLog.read());
    assert.deepEqual(report.placed.position,[.5,-.35,0]);assert.equal(report.placed.fire.basin.presetId,cold.fire.basin.presetId);
  }
  report.phase='cold-hold';await page.waitForTimeout(800);
  assert.equal((await page.evaluate(()=>window.kaminosLiveLog.read())).fields[0].steps,0);
  const advance=async count=>page.evaluate(async count=>{
    const volume=window.__kaminosVolumePrototype;volume.setSimulationPaused(false);
    const target=volume.debugState().simStepCount+count;
    const receipt=await volume.pauseSelectiveHeadLiveAtSimStep(target);
    if(!receipt.ok||!receipt.gpuComplete||receipt.effectiveSimStepCount!==target)throw Error('Exact step pause failed '+JSON.stringify(receipt));
    return receipt;
  },count);
  report.phase='heating';await page.locator('#live-log-heat [data-action=run]').click();
  report.plannedHeatSteps=mode==='initial'?300:900;
  report.heatPause=await advance(report.plannedHeatSteps);await shot('heated');
  const heated=report.frames.at(-1).state;assert.ok(heated.fields.every(f=>f.steps>0&&f.lastSource.dimensions[0]===48));
  assert.ok(heated.materials.every(m=>m.stateAuthority==='kaminos.live-log.local-heat.v1'&&m.controls===null));
  if(mode==='full'){
  report.phase='moved-contact';const before=heated.fields.map(f=>f.generation);
  await page.evaluate(()=>window.kaminosLiveLog.invoke('move',{position:[1.3,-.35,0]}));
  const moved=await page.evaluate(()=>window.kaminosLiveLog.read());assert.deepEqual(moved.fields.map(f=>f.generation),before);
  report.movePause=await advance(300);await shot('moved');
  assert.notDeepEqual(report.frames.at(-1).state.fields[0].lastSource.localToVolume,heated.fields[0].lastSource.localToVolume);
  report.phase='cooling';await page.evaluate(()=>window.kaminosLiveLog.invoke('burnerOff'));
  report.coolPause=await advance(1800);await shot('cooled');assert.equal(report.frames.at(-1).state.burner,false);
  report.phase='reset';await page.locator('#live-log-heat [data-action=reset]').click();await shot('reset');
  const reset=report.frames.at(-1).state;assert.equal(reset.status,'cold');assert.equal(reset.paused,true);assert.equal(reset.fields[0].steps,0);assert.notEqual(reset.attempt,cold.attempt);
  }
  report.phase='cleanup';await page.evaluate(()=>window.kaminosLiveLog.dispose());
  assert.equal((await page.evaluate(()=>window.__kaminosVolumePrototype.debugState())).active,false);
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){primaryError=error;report.status='failed';report.error=String(error?.stack||error);throw error;}
finally {
  const shutdownErrors=[];report.captureStatus=report.status;
  try{if(browser)await browser.close();}catch(error){shutdownErrors.push(error);}
  try{if(server)await server.stop();}catch(error){shutdownErrors.push(error);}
  report.shutdownComplete=shutdownErrors.length===0;
  if(shutdownErrors.length){report.status='failed';if(!primaryError)report.phase='shutdown';report.shutdownErrors=shutdownErrors.map(error=>String(error?.stack||error));if(!report.error)report.error=report.shutdownErrors.join('\n');}
  try{await save();}catch(error){if(!primaryError)throw error;console.error('Terminal report write failed:',error);}
  if(shutdownErrors.length&&!primaryError)throw new AggregateError(shutdownErrors,'Witness shutdown failed');
}
