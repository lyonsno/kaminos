// Actual Kaminos Generate controls, local FLUX.3 weights, saved PNG and shared GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {launchChrome,sourceIdentity} from '../flux2-klein/cdp-harness.mjs';
import {verifyAuthoringServer} from '../../scene-authoring-witness-identity.mjs';
import {readPngProvenance} from '../../authoring-image-generation.mjs';

export function validateFlux3AuthoringResult(r){
  assert.equal(r.runtime.flux3?.mounted,true,'local FLUX.3 pack is mounted');
  assert.equal(r.runtime.flux3.modelRoot,r.expectedModelRoot,'effective local package');
  assert.equal(r.provenance.model,'FLUX.3 Image Klein');
  assert.equal(r.provenance.route,'flux3-klein.text-to-image.authoring-shared-device.v0');
  assert.equal(r.provenance.weights,'/flux3-weights');
  assert.equal(r.provenance.transformer,'/flux3-weights/dit');
  assert.deepEqual(r.provenance.sampling,r.manifest.sampling);
  assert.deepEqual(r.provenance.source,r.manifest.source);
  assert.deepEqual(r.provenance.lora,r.manifest.lora);
  for(const key of ['width','height']){
    assert.equal(r.output[key],r.expectedSize);assert.equal(r.provenance[key],r.expectedSize);
  }
  assert.ok(r.output.bytes>0&&r.output.distinctRgb>1,'a retained nonblank image');
  const interval=r.frames.inference;
  assert.ok(interval&&interval.finishedAt>interval.startedAt&&interval.after>interval.before,'foreground frames advance during actual pipeline inference');
  assert.ok(Array.isArray(r.frames.compute)&&r.frames.compute.length>0,'actual denoising stage observations exist');
  assert.ok(r.frames.compute.every(s=>s.finishedAt>s.startedAt&&s.startedAt>=interval.startedAt&&s.finishedAt<=interval.finishedAt),'compute intervals belong to this inference');
  assert.ok(r.frames.compute.some(s=>s.after>s.before),'foreground frames complete during transformer computation');
  assert.deepEqual(r.gpuErrors,[]);
  return r;
}

export async function waitForAuthoringGpuHost({read,wait}){
  for(;;){const host=await read();if(host)return host;await wait();}
}

async function main(){
  const {values:v}=parseArgs({options:{origin:{type:'string'},out:{type:'string'},chrome:{type:'string'},'repo-root':{type:'string'},'weights-root':{type:'string'},size:{type:'string',default:'512'}}});
  assert.ok(v.out,'--out is required');const out=path.resolve(v.out);await fs.mkdir(out,{recursive:true});
  const report={schema:'kaminos.flux3.authoring-smoke.v1',receiver:'thomas-the-jank-engine',requested:v,startedAt:new Date().toISOString(),phase:'setup',ok:false};
  const write=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  let browser;
  await write();
  try{
    for(const field of ['origin','chrome','repo-root','weights-root'])assert.ok(v[field],`--${field} is required`);
    const repo=await fs.realpath(v['repo-root']);report.source=sourceIdentity(repo);
    report.executable=await fs.realpath(v.chrome);
    assert.ok(!report.executable.includes('/Google Chrome.app/'),'independent browser required');
    report.phase='server-identity';await write();
    report.serving=await verifyAuthoringServer({origin:v.origin,repoRoot:repo});
    report.runtime=await (await fetch(`${v.origin}/api/runtime-config`)).json();
    report.expectedModelRoot=await fs.realpath(v['weights-root']);
    assert.equal(report.runtime.flux3?.mounted,true,'requested local FLUX.3 weights must be mounted');
    assert.equal(report.runtime.flux3.modelRoot,report.expectedModelRoot);
    report.manifest=await (await fetch(`${v.origin}/flux3-weights/dit/manifest.json`)).json();
    // Keep recipe/source identity, not a second copy of all tensor descriptions.
    report.manifest={source:report.manifest.source,sampling:report.manifest.sampling,lora:report.manifest.lora};
    report.phase='browser';await write();
    browser=await launchChrome(report.executable,['--disable-background-timer-throttling','--disable-renderer-backgrounding'],report);
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    report.url=`${v.origin}/index.html?workspace=authoring`;
    await browser.navigate(report.url,'!!window.kaminosAssets?.images && !!document.getElementById("asset-image-model")');
    report.phase='gpu-host';await write();
    report.device=await waitForAuthoringGpuHost({read:()=>browser.evaluate(`(async()=>{const host=await window.kaminosAppGpu();if(!host)return null;
      window.flux3SmokeGpuErrors=[];host.device.addEventListener('uncapturederror',e=>window.flux3SmokeGpuErrors.push(e.error.message));
      return {features:[...host.device.features],adapter:{vendor:host.adapter.info.vendor,architecture:host.adapter.info.architecture,device:host.adapter.info.device,description:host.adapter.info.description}};})()`),
      wait:async()=>{if(report.console.some(line=>line.startsWith('exception:')))throw Error('Page failed while constructing its GPU host');await write();await new Promise(resolve=>setTimeout(resolve,1000));}});
    assert.ok(report.device.features.includes('shader-f16'));
    report.prompt='A copper kettle with a round handle, isolated on a plain white background, studio product photo';
    report.seed=7006;report.expectedSize=Number(v.size);
    report.phase='generate';await write();
    // Observe the actual pipeline promise, excluding weight loading and PNG persistence.
    // This wrapper preserves the production method and its caller; no synthetic work is substituted.
    await browser.evaluate(`(async()=>{const {Flux3Pipeline}=await import('./models/flux3-klein/flux3-pipeline.js');
      const {Flux3Transformer}=await import('./models/flux3-klein/flux3-transformer.js');
      const forward=Flux3Transformer.prototype.forward;
      Flux3Transformer.prototype.forward=async function(...args){
        const active=window.flux3SmokeInference;
        // Precompile also invokes forward(); it cannot count as generation evidence.
        if(!active||active.finishedAt!==undefined)return forward.apply(this,args);
        const stage={before:window.kaminosAppFrameSource()?.completedFrames??0,startedAt:performance.now()};
        window.flux3SmokeCompute.push(stage);
        try{return await forward.apply(this,args);}
        finally{stage.after=window.kaminosAppFrameSource()?.completedFrames??0;stage.finishedAt=performance.now();}
      };
      const original=Flux3Pipeline.prototype.generate;
      Flux3Pipeline.prototype.generate=async function(options){
        const interval={before:window.kaminosAppFrameSource()?.completedFrames??0,startedAt:performance.now()};
        window.flux3SmokeInference=interval;window.flux3SmokeCompute=[];
        try{return await original.call(this,options);}
        finally{interval.after=window.kaminosAppFrameSource()?.completedFrames??0;interval.finishedAt=performance.now();}
      };
      window.kaminosAssets.open('generate');
      const byId=id=>document.getElementById(id);byId('asset-image-model').value='flux3';byId('asset-image-model').dispatchEvent(new Event('change'));
      byId('asset-image-size').value=${JSON.stringify(v.size)};byId('asset-prompt').value=${JSON.stringify(report.prompt)};byId('asset-seed').value='7006';
      window.flux3SmokeFrames={before:(window.kaminosAppFrameSource()?.completedFrames??0),after:0};
      if(byId('asset-text-run').disabled)throw Error('Generate image is disabled');byId('asset-text-run').click();})()`);
    let last;
    for(;;){
      const state=await browser.evaluate('window.kaminosAssets.images.read()');
      if(['failed','stopped','unavailable'].includes(state.status))throw Error(JSON.stringify(state));
      if(JSON.stringify(state)!==last){report.state=state;last=JSON.stringify(state);await write();}
      if(state.status==='complete')break;
      if(report.console.some(line=>line.startsWith('exception:')))throw Error('Uncaught page exception');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    report.phase='retain-output';await write();
    const saved=await browser.evaluate(`(async()=>{const entry=window.kaminosAssets.images.read().results.at(-1);if(!entry?.source)throw Error('No saved source');
      const response=await fetch(entry.source);if(!response.ok)throw Error('Saved PNG unavailable');const blob=await response.blob();
      const bitmap=await createImageBitmap(blob),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
      const pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height).data,colors=new Set();for(let i=0;i<pixels.length;i+=4)colors.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);
      const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
      return {entry,data,output:{width:bitmap.width,height:bitmap.height,bytes:blob.size,distinctRgb:colors.size},frames:{...window.flux3SmokeFrames,after:window.kaminosAppFrameSource()?.completedFrames??0,inference:window.flux3SmokeInference,compute:window.flux3SmokeCompute},gpuErrors:window.flux3SmokeGpuErrors,selected:window.kaminosAssets.read().selected};})()`);
    const bytes=Buffer.from(saved.data,'base64');await fs.writeFile(path.join(out,'generated.png'),bytes);
    report.provenance=readPngProvenance(bytes);report.output={...saved.output,sha256:createHash('sha256').update(bytes).digest('hex')};
    report.entry=saved.entry;report.selected=saved.selected;report.frames=saved.frames;report.gpuErrors=saved.gpuErrors;
    validateFlux3AuthoringResult(report);
    assert.equal(report.selected?.kind,'image','the saved image is selected for the mesh input');
    assert.equal(report.selected.source,report.entry.source,'mesh input uses this generated image');
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const screenshot=await browser.send('Page.captureScreenshot',{format:'png'});
    assert.ok(screenshot.result?.data,'browser screenshot');await fs.writeFile(path.join(out,'app.png'),Buffer.from(screenshot.result.data,'base64'));
    report.phase='done';report.ok=true;
  }catch(error){report.failurePhase=report.phase;report.error=String(error.stack||error);process.exitCode=1;}
  finally{
    try{
      if(browser)await browser.close();
      else if(report.ownedBrowserPid&&!report.browserExit)process.kill(report.ownedBrowserPid,'SIGTERM');
    }catch(error){report.cleanupError=String(error);report.ok=false;process.exitCode=1;}
    report.finishedAt=new Date().toISOString();await write();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
