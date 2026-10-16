import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const [origin,out]=process.argv.slice(2);if(!origin||!out)throw Error('Usage: fuse-witness.mjs <origin> <output>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:path.resolve(import.meta.dirname,'..'),errors:[],frames:[],requested:{grid:32,rays:28,radius:.1,gi:{steps:4,slices:3},experiment:'curved-fuse'},claim:'Provisional energetic cord in the shared32grid; local ignition and propagation, not physical calibration or benchmark'};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));let browser;
try{
  await save();report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
  report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'));
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(0);
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const preset='vsp-5d3c953814884ed597721350fde28d275a00af04a087d8bb5ec8127984c92bcc';
  report.url=origin+'/volume-settings-preset.html?preset='+preset+'#experiment=curved-fuse&volume_light_field=1&volume_light_field_scene_depth=1&volume_light_field_test_scene=0&volume_collision=kiln';
  report.phase='load';await save();await page.goto(report.url);
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='curved-fuse'||window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed'));
  const startup=await page.evaluate(()=>({state:window.kaminosWorkbenchExperiments?.state(),error:window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed')?.textContent}));
  assert.equal(startup.error,undefined,JSON.stringify(startup));assert.equal(startup.state.id,'curved-fuse');report.effectiveUrl=page.url();
  report.sources=[];for(const name of ['fuse-core.mjs','fuse-gpu.mjs','experiments/sinter/curved-fuse.experiment.mjs','volume-core.js','lib/three.webgpu.js']){
    const served=await(await page.request.get(origin+'/'+name)).body(),local=await fs.readFile(path.join(report.repoRoot,name)),sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(served),sha(local),name);report.sources.push({name,sha256:sha(served)});
  }
  report.effective=await page.evaluate(()=>({backend:window.__kaminosVolumePrototype.debugState().backend,gi:window.kaminosSceneGIDebugState(),controls:Object.fromEntries(['volume-resolution','volume-grid-height-ratio','volume-steps','volume-immersed-radius'].map(id=>[id,document.getElementById(id).value]))}));
  assert.match(report.effective.backend,/WebGPU/);assert.equal(Number(report.effective.controls['volume-resolution']),32);assert.equal(Number(report.effective.controls['volume-grid-height-ratio']),1);assert.equal(Number(report.effective.controls['volume-steps']),28);assert.equal(Number(report.effective.controls['volume-immersed-radius']),.1);assert.equal(report.effective.gi.steps,4);assert.equal(report.effective.gi.slices,3);
  const invoke=(name,input)=>page.evaluate(({name,input})=>window.kaminosWorkbenchExperiments.invoke(name,input),{name,input});
  async function sample(name){
    const raw=await invoke('sample');await fs.writeFile(path.join(out,name+'-raw.json'),JSON.stringify(raw));
    assert.equal(raw.state.field.representation,'arc-length-material-chain');assert.equal(raw.cells.length,96*8);assert.ok(raw.cells.every(Number.isFinite));
    const row={name,state:raw.state,ignited:[],spent:[],hot:[]};for(let i=0;i<96;i++){if(raw.cells[i*8+7]>.5)row.ignited.push(i);if(raw.cells[i*8+5]<.5)row.spent.push(i);if(raw.cells[i*8]>.8)row.hot.push(i);}
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(out,name+'.png')});report.frames.push(row);await save();return row;
  }
  const cold=await sample('cold');assert.equal(cold.state.paused,true);assert.equal(cold.state.field.steps,0);assert.deepEqual(cold.ignited,[]);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'cold-mobile.png')});await page.setViewportSize({width:1440,height:1000});
  const advance=async target=>{await page.evaluate(target=>window.__kaminosVolumePrototype.pauseSelectiveHeadLiveAtSimStep(target),target);await invoke('pause');};
  report.phase='ignite';await save();await invoke('run');await advance(180);const hot=await sample('lighter-on');assert.ok(hot.ignited.length>0,'Real fluid heat must ignite the fuse');
  await invoke('lighterOff');await invoke('pause');await advance(1080);const after=await sample('lighter-off');assert.equal(after.state.lighter,false);
  assert.ok(after.spent.some(i=>!hot.spent.includes(i)),'Fuel must continue burning after the lighter is off');
  assert.ok(Math.max(...after.ignited)>Math.max(...hot.ignited),'The front must advance beyond initially ignited material');
  await invoke('flameView',{visible:false});await page.evaluate(()=>window.kaminosSelection.clear());await sample('material-front');
  await invoke('reset');const reset=await sample('reset');assert.equal(reset.state.paused,true);assert.equal(reset.state.field.steps,0);assert.deepEqual(reset.ignited,[]);
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());await page.evaluate(()=>window.kaminosWorkbenchExperiments.open('curved-fuse',{}));const reopened=await sample('reopened');assert.equal(reopened.state.field.steps,0);
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();await save();}
