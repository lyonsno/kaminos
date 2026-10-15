import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [origin,out]=process.argv.slice(2);
if(!origin||!out)throw Error('Usage: live-log-current-witness.mjs <origin> <output>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:path.resolve(import.meta.dirname,'..'),errors:[],frames:[],
  executable:process.env.CHROME_EXECUTABLE,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  requested:{grid:[32,32,32],rays:28,emitterRadius:.1,gi:{steps:4,slices:3}},claim:'GPU material observability and lightweight scene, not self-sustaining combustion'};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let browser;
try {
  await save();
  assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'),'Independent browser required');
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  report.phase='browser-launch';await save();
  browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  report.phase='page-create';report.browserVersion=browser.version();await save();
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(0);
  page.on('pageerror',error=>report.errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  report.phase='load';await save();
  const recipe='vsp-5d3c953814884ed597721350fde28d275a00af04a087d8bb5ec8127984c92bcc';
  report.requestedUrl=origin+'/volume-settings-preset.html?preset='+recipe+'#experiment=live-log-heat&volume_light_field=1&volume_light_field_scene_depth=1&volume_light_field_test_scene=0';
  await page.goto(report.requestedUrl);
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='live-log-heat'||window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed'));
  const startup=await page.evaluate(()=>({state:window.kaminosWorkbenchExperiments?.state(),error:window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed')?.textContent}));
  assert.equal(startup.error,undefined,JSON.stringify(startup));assert.equal(startup.state.id,'live-log-heat');
  report.effectiveUrl=page.url();report.browserVersion=browser.version();
  report.sources=[];
  for(const name of ['index.html','volume-core.js','volume-physics-appearance.mjs','live-log-experiment.mjs','live-log-heat-gpu.mjs','burn-table-material.mjs','live-log-indicator.mjs']) {
    const actual=await(await page.request.get(origin+'/'+name)).body(),expected=await fs.readFile(path.join(report.repoRoot,name));
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(sha(actual),sha(expected),name);report.sources.push({name,sha256:sha(actual)});
  }
  const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  const invoke=(name,input)=>page.evaluate(({name,input})=>window.kaminosWorkbenchExperiments.invoke(name,input),{name,input});
  const shot=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:path.join(out,name+'.png')});report.frames.push({name,state:await read()});await save();};
  report.cold=await read();assert.equal(report.cold.paused,true);assert.equal(report.cold.fields[0].steps,0);
  report.effective=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),grid:window.__kaminosVolumePrototype.debugState().gridHeight,
    controls:Object.fromEntries(['volume-resolution','volume-grid-height-ratio','volume-steps','volume-immersed-radius'].map(id=>[id,document.getElementById(id).value]))}));
  assert.equal(report.effective.controls['volume-resolution'],'32');assert.equal(Number(report.effective.controls['volume-grid-height-ratio']),1);
  assert.equal(Number(report.effective.controls['volume-steps']),28);assert.equal(Number(report.effective.controls['volume-immersed-radius']),.1);
  await shot('cold');
  report.phase='heat';await save();
  await invoke('move',{position:[0,0,0]});
  await invoke('frame');
  await page.locator('#live-log-heat [data-action=run]').click();
  await page.waitForFunction(()=>window.__kaminosVolumePrototype.thermalConsumerState()?.fields[0].steps>=600);
  await invoke('pause');await page.evaluate(()=>window.kaminosSelection.clear());await shot('warm');
  await invoke('flameView',{visible:false});
  await invoke('view',{mode:'char'});assert.equal(await page.locator('#live-log-heat [name=burn-view]:checked').inputValue(),'char');await shot('char');
  await invoke('view',{mode:'heat'});await shot('heat');
  report.phase='end-exposure';await save();
  await invoke('move',{position:[-.4,0,0]});await invoke('pause');
  await page.waitForFunction(()=>window.__kaminosVolumePrototype.thermalConsumerState()?.fields[0].steps>=1200);
  await invoke('pause');await invoke('frame');await invoke('view',{mode:'char'});await shot('end-char');
  await invoke('view',{mode:'beauty'});await shot('end-material');await invoke('burnerOff');
  report.phase='reset';await invoke('reset');await shot('reset');assert.equal((await read()).fields[0].steps,0);
  report.phase='mobile';await page.setViewportSize({width:430,height:900});await shot('mobile');
  const active=await read();assert.equal(active.burnStatusAuthority,'resident-gpu-peak-reaction');assert.equal(active.selfEmission,false);
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();await save();}
