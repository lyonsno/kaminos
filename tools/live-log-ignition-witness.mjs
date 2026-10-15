import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {checkColdLogEntryCollision} from './live-log-witness-contracts.mjs';

const [origin,out]=process.argv.slice(2);
if(!origin||!out)throw Error('Usage: live-log-ignition-witness.mjs <origin> <output>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:path.resolve(import.meta.dirname,'..'),errors:[],frames:[],arms:[],
  requested:{grid:[32,32,32],rays:28,emitterRadius:.1,gi:{steps:4,slices:3},heatSteps:600,offSteps:900,entryOnly:process.env.SINTER_ENTRY_ONLY==='1'},
  claim:process.env.SINTER_ENTRY_ONLY==='1'?'Cold operator entry and effective collision setup only; no combustion claim':'One solid log supplying real gas after authored burner off; uncalibrated wood, not propagation or benchmark'};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));let browser;
try{
  await save();report.sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
  report.executable=process.env.CHROME_EXECUTABLE;
  assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'),'Independent browser required');
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(0);report.browserVersion=browser.version();
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  // Evidence-only copies. Production state remains resident and has no CPU feedback.
  await page.addInitScript(()=>{
    const create=GPUDevice.prototype.createBuffer;window.__woodEvidenceBuffers=new Map();
    GPUDevice.prototype.createBuffer=function(d){
      const tracked=d.label?.startsWith('live log resident state ');
      const b=create.call(this,tracked?{...d,usage:d.usage|GPUBufferUsage.COPY_SRC}:d);
      if(tracked)window.__woodEvidenceBuffers.set(d.label,b);return b;
    };
  });
  const recipe='vsp-5d3c953814884ed597721350fde28d275a00af04a087d8bb5ec8127984c92bcc';
  report.requestedUrl=origin+'/volume-settings-preset.html?preset='+recipe+'#experiment=live-log-heat&volume_light_field=1&volume_light_field_scene_depth=1&volume_light_field_test_scene=0&volume_collision=kiln';
  report.phase='load';await save();await page.goto(report.requestedUrl);
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='live-log-heat'||window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed'));
  const startup=await page.evaluate(()=>({state:window.kaminosWorkbenchExperiments?.state(),error:window.kaminosWorkbenchExperimentError||document.querySelector('#status.failed')?.textContent}));
  assert.equal(startup.error,undefined,JSON.stringify(startup));assert.equal(startup.state.id,'live-log-heat');
  report.effectiveUrl=page.url();report.sources=[];
  for(const name of ['volume-core.js','live-log-experiment.mjs','experiments/sinter/live-log-heat.experiment.mjs','live-log-heat-gpu.mjs','live-log-heat-core.mjs','live-log-gas-source.mjs']){
    const actual=await(await page.request.get(origin+'/'+name)).body(),expected=await fs.readFile(path.join(report.repoRoot,name));
    const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(actual),sha(expected),name);report.sources.push({name,sha256:sha(actual)});
  }
  const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  const invoke=(name,input)=>page.evaluate(({name,input})=>window.kaminosWorkbenchExperiments.invoke(name,input),{name,input});
  report.effective=await page.evaluate(()=>({backend:window.__kaminosVolumePrototype.debugState().backend,gi:window.kaminosSceneGIDebugState(),
    controls:Object.fromEntries(['volume-resolution','volume-grid-height-ratio','volume-steps','volume-immersed-radius'].map(id=>[id,document.getElementById(id).value]))}));
  assert.match(report.effective.backend,/WebGPU/);assert.equal(Number(report.effective.controls['volume-resolution']),32);
  assert.equal(Number(report.effective.controls['volume-grid-height-ratio']),1);assert.equal(Number(report.effective.controls['volume-steps']),28);assert.equal(Number(report.effective.controls['volume-immersed-radius']),.1);
  assert.equal(report.effective.gi.steps,4);assert.equal(report.effective.gi.slices,3);
  async function sample(name){
    const raw=await page.evaluate(async()=>{
      const runtime=window.__kaminosVolumePrototype,state=await window.kaminosWorkbenchExperiments.read(),context=await runtime.borrowThermalGpuContext();
      const buffer=window.__woodEvidenceBuffers.get('live log resident state '+state.fields[0].steps%2);
      if(!buffer)throw Error('Missing evidence buffer');
      const device=context.device,staging=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      let wood;
      try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,staging,0,buffer.size);device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);wood=Array.from(new Float32Array(staging.getMappedRange()));staging.unmap();}finally{staging.destroy();}
      return {state,wood,gas:await runtime.sampleReactantFields(),chemistry:runtime.debugState().reactantCombustion,source:runtime.debugState().residentGasSource,collision:window.kaminosSceneCollision.read()};
    });
    await fs.writeFile(path.join(out,name+'-raw.json'),JSON.stringify(raw));
    assert.equal(raw.gas.ok,true);assert.equal(raw.chemistry.effective.admitted,true);assert.equal(raw.source.admitted,true);
    assert.equal(raw.collision.runtime.effective,'mesh-voxel-solid');assert.ok(raw.collision.runtime.solidCellCount>0);
    const stats={wood:{peakHeat:0,peakChar:0,peakReaction:0,ignited:0,fuelLost:0},gas:{fuel:0,heat:0,freshBurn:0,peakBurn:0}};
    for(let i=0;i<raw.wood.length;i+=8){assert.ok(raw.wood.slice(i,i+8).every(Number.isFinite),'Nonfinite wood');stats.wood.peakHeat=Math.max(stats.wood.peakHeat,raw.wood[i]);stats.wood.peakChar=Math.max(stats.wood.peakChar,raw.wood[i+1]);stats.wood.peakReaction=Math.max(stats.wood.peakReaction,raw.wood[i+2]);stats.wood.ignited+=raw.wood[i+7]>.5;stats.wood.fuelLost+=1-raw.wood[i+5];}
    const fluid=new Float32Array(Uint8Array.from(Buffer.from(raw.gas.fluidBase64,'base64')).buffer),reactant=new Float32Array(Uint8Array.from(Buffer.from(raw.gas.reactantBase64,'base64')).buffer);
    for(let i=0;i<fluid.length;i+=16){assert.ok(fluid.slice(i,i+16).every(Number.isFinite),'Nonfinite gas');stats.gas.fuel+=fluid[i+6];stats.gas.heat+=fluid[i+5];}
    for(let i=1;i<reactant.length;i+=2){assert.ok(Number.isFinite(reactant[i]));stats.gas.freshBurn+=reactant[i];stats.gas.peakBurn=Math.max(stats.gas.peakBurn,reactant[i]);}
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(out,name+'.png')});
    const row={name,stats,state:raw.state,source:raw.source,chemistry:raw.chemistry.effective};report.frames.push(row);await save();return row;
  }
  const advance=async target=>{
    await page.evaluate(target=>window.__kaminosVolumePrototype.pauseSelectiveHeadLiveAtSimStep(target),target);
    await invoke('pause');
  };
  report.phase='cold';await save();assert.equal((await read()).paused,true);assert.equal((await read()).fields[0].steps,0);
  if(report.requested.entryOnly){
    report.entry=await read();report.collision=await page.evaluate(()=>window.kaminosSceneCollision.read());
    assert.equal(report.entry.burner,false);assert.equal(report.entry.gasSource.enabled,true);assert.equal(report.collision.enabled,true);
    checkColdLogEntryCollision(report.entry,report.collision);
    await page.screenshot({path:path.join(out,'entry-cold.png')});report.frames.push({name:'entry-cold',state:report.entry});
  }else{
  for(const feed of [false,true]){
    const name=feed?'wood-feed':'no-feed';report.phase=name;await save();
    await invoke('reset');await invoke('view',{mode:'beauty'});await invoke('move',{position:[0,0,0]});
    await invoke('fuelFeed',{enabled:feed});await invoke('frame');await page.evaluate(()=>window.kaminosSelection.clear());await invoke('run');
    await advance(report.requested.heatSteps);const hot=await sample(name+'-hot');assert.ok(hot.stats.wood.ignited>0,'Sustained heat must ignite local wood');
    await invoke('burnerOff');
    // Resume compute while releasing the exact-step presentation pause.
    await invoke('pause');
    await advance(report.requested.heatSteps+report.requested.offSteps);const after=await sample(name+'-burner-off');
    assert.equal(after.state.burner,false);report.arms.push({feed,hot,after});await save();
  }
  const off=report.arms.find(a=>!a.feed),on=report.arms.find(a=>a.feed);
  assert.ok(on.after.stats.gas.freshBurn>off.after.stats.gas.freshBurn*2 && on.after.stats.gas.freshBurn>.001,'Wood feed must sustain fresh gas burning beyond residual control');
  assert.ok(on.after.stats.wood.fuelLost>on.hot.stats.wood.fuelLost,'Continuing flame must consume finite wood fuel');
  report.phase='withdraw-wood-feed';await save();
  await invoke('fuelFeed',{enabled:false});await invoke('pause');
  await advance(report.requested.heatSteps+2*report.requested.offSteps);
  report.withdrawn=await sample('wood-feed-withdrawn');
  assert.equal(report.withdrawn.state.burner,false);assert.equal(report.withdrawn.state.gasSource.enabled,false);
  assert.ok(report.withdrawn.stats.gas.freshBurn<on.after.stats.gas.freshBurn*.01,'Withdrawing wood fuel must extinguish continuing gas combustion');
  assert.equal(report.withdrawn.stats.wood.peakReaction,0,'Wood must stop releasing gas after it cools without flame feedback');
  }
  assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();await save();}
