import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const [origin,out]=process.argv.slice(2);if(!origin||!out)throw Error('Usage: moving-log-witness.mjs <origin> <out>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:path.resolve(import.meta.dirname,'..'),errors:[],frames:[],inputs:[],requested:{grid:32,rays:28,radius:.1,gi:{steps:4,slices:3},experiment:'moving-log'},claim:'One world-aligned object-following32grid with emitted-gas momentum; no moving-wall pressure, exterior retention or benchmark'};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));let browser;
try{
 await save();report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'));
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
 browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(origin+'/tools/moving-volume-fixture.html');await page.waitForFunction(()=>window.runMovingVolumeConformance);report.phase='kernel';await save();report.kernel=await page.evaluate(()=>window.runMovingVolumeConformance());await save();assert.equal(report.kernel.status,'passed');
 report.phase='scene';report.url=origin+'/volume-settings-preset.html?preset=vsp-5d3c953814884ed597721350fde28d275a00af04a087d8bb5ec8127984c92bcc#experiment=moving-log&volume_light_field=1&volume_light_field_scene_depth=1&volume_light_field_test_scene=0&volume_collision=kiln';await save();
 await page.goto(report.url);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='moving-log'||window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed'));
 const startup=await page.evaluate(()=>({state:window.kaminosWorkbenchExperiments?.state(),error:window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed')?.textContent}));assert.equal(startup.error,undefined,JSON.stringify(startup));assert.equal(startup.state.id,'moving-log');
 report.sources=[];for(const name of ['volume-core.js','index.html','moving-volume.mjs','moving-volume-gpu.mjs','material-motion-gpu.mjs','live-log-experiment.mjs','experiments/sinter/moving-log.experiment.mjs','tools/moving-volume-fixture.mjs']){
  const served=await(await page.request.get(origin+'/'+name)).body(),local=await fs.readFile(path.join(report.repoRoot,name)),sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(served),sha(local),name);report.sources.push({name,sha256:sha(served)});
 }
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const invoke=async(name,input)=>{report.inputs.push({name,input});return page.evaluate(({name,input})=>window.kaminosWorkbenchExperiments.invoke(name,input),{name,input});};
 const advance=async target=>{report.inputs.push({advanceTo:target});const receipt=await page.evaluate(target=>window.__kaminosVolumePrototype.pauseSelectiveHeadLiveAtSimStep(target),target);assert.equal(receipt.ok,true,JSON.stringify(receipt));assert.equal(receipt.effectiveSimStepCount,target);await invoke('pause');return receipt;};
 async function sample(name){
  const raw=await page.evaluate(async()=>({state:await window.kaminosWorkbenchExperiments.read(),gas:await window.__kaminosVolumePrototype.sampleReactantFields(),runtime:window.__kaminosVolumePrototype.debugState(),gi:window.kaminosSceneGIDebugState()}));
  await fs.writeFile(path.join(out,name+'-raw.json'),JSON.stringify(raw));assert.equal(raw.gas.ok,true);assert.match(raw.runtime.backend,/WebGPU/);assert.equal(raw.runtime.simGrid,32);assert.equal(raw.runtime.gridHeight.heightCells,32);assert.equal(raw.gi.steps,4);assert.equal(raw.gi.slices,3);
  const f=new Float32Array(Uint8Array.from(Buffer.from(raw.gas.fluidBase64,'base64')).buffer),r=new Float32Array(Uint8Array.from(Buffer.from(raw.gas.reactantBase64,'base64')).buffer);
  assert.equal(f.length,32**3*16);assert.ok(f.every(Number.isFinite)&&r.every(Number.isFinite));
  let heat=0,burn=0;for(let i=0;i<f.length;i+=16)heat+=f[i+5];for(let i=1;i<r.length;i+=2)burn+=r[i];
  await page.evaluate(()=>window.__kaminosVolumePrototype.setSelectiveHeadLiveCapturePaused(false));
  const before=await page.evaluate(()=>window.kaminosSceneGIDebugState().sceneFrames);await page.waitForFunction(before=>window.kaminosSceneGIDebugState().sceneFrames>before,before);
  await page.screenshot({path:path.join(out,name+'.png')});const row={name,state:raw.state,heat,burn,resets:raw.runtime.fluidStateResetCount,allocation:raw.runtime.thermalFluidAllocationId};report.frames.push(row);await save();return row;
 }
 const cold=await read();assert.equal(cold.paused,true);assert.equal(cold.fields[0].steps,0);assert.equal(cold.burner,false);assert.ok(cold.followingDomain);
 await invoke('frame');await invoke('run');report.phase='heat';await save();await advance(600);const hot=await sample('hot');assert.ok(hot.burn>.001,'Source must establish gas burning');
 await invoke('burnerOff');await invoke('pause');await advance(720);const off=await sample('burner-off');assert.equal(off.state.burner,false);assert.ok(off.burn>.001);
 report.phase='carry';await save();
 for(let i=1;i<=20;i++){await invoke('move',{position:[i*.05,0,0]});await invoke('pause');await advance(720+i*6);if(i===10)await sample('carry-half');}
 const moved=await sample('carried');assert.ok(moved.state.followingDomain.shifts>0);assert.ok(moved.state.followingDomain.translation[0]>.9);assert.equal(moved.resets,off.resets,'Following cannot reset the gas');assert.equal(moved.allocation,off.allocation);assert.ok(moved.burn>.001,'Burning must survive leaving the original grid center');assert.ok(moved.state.fields[0].steps>off.state.fields[0].steps);
 await invoke('move',{position:[1,0,.25],rotation:[0,1.1,0]});await invoke('pause');await advance(870);await sample('turned');
 const held=await read();await invoke('pause');await advance(900);const still=await sample('stationary');assert.equal(still.state.followingDomain.shifts,held.followingDomain.shifts,'Stationary object cannot keep shifting grid');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png')});
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.equal(await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().followingDomain.status),'released');
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();await save();}
