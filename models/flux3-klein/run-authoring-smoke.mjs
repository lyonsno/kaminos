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
  const model=r.model??'flux3';assert.ok(['flux2','flux3'].includes(model),'known requested model');
  const mount=model==='flux2'?'klein':'flux3',base=model==='flux2'?'/klein-weights':'/flux3-weights';
  assert.equal(r.runtime[mount]?.mounted,true,'local model pack is mounted');
  assert.equal(r.runtime[mount].modelRoot,r.expectedModelRoot,'effective local package');
  assert.equal(r.provenance.model,model==='flux2'?'FLUX.2 [klein] 4B':'FLUX.3 Image Klein');
  assert.equal(r.provenance.route,`${model}-klein.${r.reference?'image-and-text':'text-to-image'}.authoring-shared-device.v0`);
  if(r.reference){
    assert.equal(r.provenance.reference?.source,r.reference.source,'selected reference source');
    assert.equal(r.provenance.reference?.sha256,r.reference.sha256,'selected reference bytes');
  }
  assert.equal(r.provenance.weights,base);
  assert.equal(r.provenance.transformer,`${base}/dit`);
  if(model==='flux3')assert.deepEqual(r.provenance.sampling,r.manifest.sampling);
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
  assert.ok(r.load?.finishedAt>r.load?.startedAt,'completed cold load interval');
  assert.equal(r.load.stats.cacheWeights,false,'local weights bypass browser caching');
  assert.equal(r.load.stats.cachedBytes,0,'fresh local file reads');
  assert.ok(r.load.stats.downloadedBytes>0,'weight bytes were actually read');
  assert.deepEqual(r.load.cacheWrites,[],'no duplicate weight cache writes');
  assert.deepEqual(r.gpuErrors,[]);
  if(r.inspectControls){
    const ui=r.inspection;assert.ok(ui,'inspection observations are required');
    assert.ok(ui.previews?.length>0,'actual partial previews must reach the canvas');
    assert.ok(ui.previews.some(p=>p.visible&&p.distinctRgb>1&&p.at>=interval.startedAt&&p.at<=interval.finishedAt),'a visible nonblank preview during this inference');
    assert.ok(ui.expandedHeight>ui.compactHeight&&ui.expandedPressed,'expansion increases the image area');
    assert.equal(ui.originalSource,r.entry.source,'original display survives generation and selection');
    assert.equal(ui.segmentedSource,ui.preparedSource,'checkbox displays the actual prepared cutout');
    assert.notEqual(ui.preparedSource,ui.originalSource,'opaque generated input has a distinct cutout');
    assert.equal(ui.preferenceAfterGeneration,false);assert.equal(ui.preferenceAfterReload,false);
    assert.ok(ui.previews.some(p=>/^Generating .* s/.test(p.timer)),'elapsed time is visible while generating');
    assert.ok(r.provenance.elapsed?.generationMs>0,'generation elapsed time is retained in the PNG');
    assert.ok(ui.timerAfter.includes(`${(r.provenance.elapsed.generationMs/1000).toFixed(1)} s`),'completed elapsed time remains visible');
  }
  if(r.decodeAfter){
    const c=r.provenance.completion;assert.ok(c,'early decode completion receipt');
    assert.equal(c.earlyDecoded,true);assert.equal(c.stepsRequested,(r.manifest.sampling?.steps??4));
    assert.equal(c.stepsCompleted,r.decodeAfter);
    const f=r.flame;assert.ok(f,'live generation flame receipt');
    assert.ok(f.after>f.before,'flame advances during actual inference');assert.equal(f.stopped,true);
    assert.equal(f.backend,'WebGPU:apple');assert.equal(f.simGrid,32);assert.equal(f.raySteps,4);assert.equal(f.width,100);assert.equal(f.height,100);
  }
  return r;
}

export async function waitForAuthoringGpuHost({read,wait}){
  for(;;){const host=await read();if(host)return host;await wait();}
}

async function main(){
  const {values:v}=parseArgs({options:{model:{type:'string',default:'flux3'},origin:{type:'string'},out:{type:'string'},chrome:{type:'string'},'repo-root':{type:'string'},'weights-root':{type:'string'},size:{type:'string',default:'512'},'inspect-controls':{type:'boolean',default:false},'decode-after':{type:'string'},'reference-source':{type:'string'},prompt:{type:'string'}}});
  assert.ok(v.out,'--out is required');const out=path.resolve(v.out);await fs.mkdir(out,{recursive:true});
  const report={schema:'kaminos.flux3.authoring-smoke.v1',receiver:'thomas-the-jank-engine',model:v.model,requested:v,startedAt:new Date().toISOString(),phase:'setup',ok:false};
  const write=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  let browser;
  report.inspectControls=v['inspect-controls'];report.decodeAfter=Number(v['decode-after'])||null;
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
    assert.ok(['flux2','flux3'].includes(v.model),'known requested model');
    const mount=v.model==='flux2'?'klein':'flux3',base=v.model==='flux2'?'/klein-weights':'/flux3-weights';
    assert.equal(report.runtime[mount]?.mounted,true,'requested local weights must be mounted');
    assert.equal(report.runtime[mount].modelRoot,report.expectedModelRoot);
    report.manifest=await (await fetch(`${v.origin}${base}/dit/manifest.json`)).json();
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
    report.prompt=v.prompt??'A copper kettle with a round handle, isolated on a plain white background, studio product photo';
    if(v['reference-source']){
      const response=await fetch(new URL(v['reference-source'],v.origin));assert.ok(response.ok,'selected reference exists');
      const bytes=Buffer.from(await response.arrayBuffer());await fs.writeFile(path.join(out,'reference.png'),bytes);
      report.reference={source:v['reference-source'],sha256:createHash('sha256').update(bytes).digest('hex')};
    }
    report.seed=7006;report.expectedSize=Number(v.size);
    report.phase='generate';await write();
    // Observe the actual pipeline promise, excluding weight loading and PNG persistence.
    // This wrapper preserves the production method and its caller; no synthetic work is substituted.
    await browser.evaluate(`(async()=>{const {${v.model==='flux2'?'KleinPipeline':'Flux3Pipeline'}:Flux3Pipeline}=await import(${JSON.stringify(v.model==='flux2'?'./models/flux2-klein/klein-pipeline.js':'./models/flux3-klein/flux3-pipeline.js')});
      const {${v.model==='flux2'?'KleinTransformer':'Flux3Transformer'}:Flux3Transformer}=await import(${JSON.stringify(v.model==='flux2'?'./models/flux2-klein/klein-transformer.js':'./models/flux3-klein/flux3-transformer.js')});
      const cacheWrites=[];const put=Cache.prototype.put;
      Cache.prototype.put=function(key,...args){const url=typeof key==='string'?key:key.url;
        if(url.includes(${JSON.stringify(base+'/')}))cacheWrites.push({url,startedAt:performance.now()});return put.call(this,key,...args);};
      const load=Flux3Pipeline.prototype.load;
      Flux3Pipeline.prototype.load=async function(...args){
        const interval=window.flux3SmokeLoad={startedAt:performance.now(),cacheWrites};
        try{return await load.apply(this,args);}
        finally{interval.finishedAt=performance.now();interval.stats=this.loadStats;interval.timings={...this.timings};}
      };
      const forward=Flux3Transformer.prototype.forward;
      Flux3Transformer.prototype.forward=async function(...args){
        const active=window.flux3SmokeInference;
        // Precompile also invokes forward(); it cannot count as generation evidence.
        if(!active||active.finishedAt!==undefined)return forward.apply(this,args);
        const stage={before:window.kaminosAppFrameSource()?.completedFrames??0,startedAt:performance.now()};
        window.flux3SmokeCompute.push(stage);
        if(window.flux3SmokeCompute.length===${report.decodeAfter}){const button=document.getElementById('asset-text-decode');if(button.hidden||button.disabled)throw Error('Decode now is unavailable');button.click();}
        try{return await forward.apply(this,args);}
        finally{stage.after=window.kaminosAppFrameSource()?.completedFrames??0;stage.finishedAt=performance.now();}
      };
      const original=Flux3Pipeline.prototype.generate;
      Flux3Pipeline.prototype.generate=async function(options){
        const interval={before:window.kaminosAppFrameSource()?.completedFrames??0,startedAt:performance.now()};
        window.flux3SmokeInference=interval;window.flux3SmokeCompute=[];window.flux3SmokeFlameBefore=window.kaminosAssets.generationFlame.read().renderer?.frameCount??0;
        window.flux3SmokePreviews=[];
        const receive=options.onPreview;
        if(${v['inspect-controls']||!!report.decodeAfter})options={...options,onPreview:frame=>{
          if(typeof receive!=='function')throw Error('Authoring omitted the preview callback');receive(frame);
          const canvas=document.getElementById('asset-step-preview'),rect=canvas.getBoundingClientRect();
          const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,colors=new Set();
          for(let i=0;i<pixels.length;i+=4)colors.add((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]);
          window.flux3SmokePreviews.push({step:frame.step,steps:frame.steps,width:canvas.width,height:canvas.height,at:performance.now(),visible:!canvas.hidden&&rect.width>0&&rect.height>0,distinctRgb:colors.size,png:canvas.toDataURL('image/png').split(',')[1],timer:document.getElementById('asset-image-timing').textContent});
        }};
        try{return await original.call(this,options);}
        finally{interval.after=window.kaminosAppFrameSource()?.completedFrames??0;interval.finishedAt=performance.now();window.flux3SmokeFlameAfter=window.kaminosAssets.generationFlame.read().renderer;}
      };
      await window.kaminosAssets.open('generate');
      const byId=id=>document.getElementById(id);byId('asset-image-model').value=${JSON.stringify(v.model)};byId('asset-image-model').dispatchEvent(new Event('change'));
      if(${!!v['reference-source']}){window.kaminosAssets.select({kind:'image',name:'Reference image',source:${JSON.stringify(v['reference-source']??null)}});byId('asset-use-reference').checked=true;byId('asset-use-reference').dispatchEvent(new Event('change'));}
      if(${v['inspect-controls']}){const toggle=byId('asset-show-segmented');if(!toggle)throw Error('Missing segmented display control');toggle.checked=false;toggle.dispatchEvent(new Event('change'));}
      byId('asset-image-size').value=${JSON.stringify(v.size)};byId('asset-prompt').value=${JSON.stringify(report.prompt)};byId('asset-seed').value='7006';
      window.flux3SmokeFrames={before:(window.kaminosAppFrameSource()?.completedFrames??0),after:0};
      if(byId('asset-text-run').disabled)throw Error('Generate image is disabled');byId('asset-text-run').click();})()`);
    let last;
    for(;;){
      const state=await browser.evaluate(`(()=>{const state=window.kaminosAssets.images.read();if(state.preview){const {rgba,...metadata}=state.preview;state.preview=metadata;}return state;})()`);
      if(['failed','stopped','unavailable'].includes(state.status))throw Error(JSON.stringify(state));
      if(JSON.stringify(state)!==last){report.state=state;last=JSON.stringify(state);await write();}
      if((v['inspect-controls']||report.decodeAfter)&&state.preview?.kind==='partial'&&!report.partialScreenshot){
        const shot=await browser.send('Page.captureScreenshot',{format:'png'});
        report.partialScreenshot='partial-app.png';await fs.writeFile(path.join(out,report.partialScreenshot),Buffer.from(shot.result.data,'base64'));
      }
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
      return {entry,data,output:{width:bitmap.width,height:bitmap.height,bytes:blob.size,distinctRgb:colors.size},frames:{...window.flux3SmokeFrames,after:window.kaminosAppFrameSource()?.completedFrames??0,inference:window.flux3SmokeInference,compute:window.flux3SmokeCompute},load:window.flux3SmokeLoad,gpuErrors:window.flux3SmokeGpuErrors,selected:window.kaminosAssets.read().selected};})()`);
    const bytes=Buffer.from(saved.data,'base64');await fs.writeFile(path.join(out,'generated.png'),bytes);
    report.provenance=readPngProvenance(bytes);report.output={...saved.output,sha256:createHash('sha256').update(bytes).digest('hex')};
    report.entry=saved.entry;report.selected=saved.selected;report.frames=saved.frames;report.gpuErrors=saved.gpuErrors;report.load=saved.load;
    if(v['inspect-controls']){
      report.phase='inspection-controls';await write();
      report.inspection=await browser.evaluate(`(async()=>{
        const byId=id=>document.getElementById(id),tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const preparation=await window.kaminosAssets.prepare();await tick();
        const originalSource=byId('asset-step-source').getAttribute('src'),preferenceAfterGeneration=byId('asset-show-segmented').checked;
        const compactHeight=byId('asset-step-source').getBoundingClientRect().height;byId('asset-image-expand').click();await tick();
        const expandedHeight=byId('asset-step-source').getBoundingClientRect().height,expandedPressed=byId('asset-image-expand').getAttribute('aria-expanded')==='true';
        byId('asset-show-segmented').click();await tick();const segmentedSource=byId('asset-step-source').getAttribute('src');
        byId('asset-show-segmented').click();await tick();
        return {previews:window.flux3SmokePreviews,originalSource,preparedSource:preparation.prepared.source,segmentedSource,preferenceAfterGeneration,compactHeight,expandedHeight,expandedPressed,timerAfter:byId('asset-image-timing').textContent};
      })()`);
      const screenshot=await browser.send('Page.captureScreenshot',{format:'png'});
      await fs.writeFile(path.join(out,'expanded-app.png'),Buffer.from(screenshot.result.data,'base64'));
      await browser.navigate(report.url,'!!window.kaminosAssets?.images && !!document.getElementById("asset-show-segmented")');
      report.inspection.preferenceAfterReload=await browser.evaluate('document.getElementById("asset-show-segmented").checked');
    }
    if(report.decodeAfter){
      await browser.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      report.flame=await browser.evaluate(`(()=>{const f=window.flux3SmokeFlameAfter,s=window.kaminosAssets.generationFlame.read();return {before:window.flux3SmokeFlameBefore,after:f?.frameCount,stopped:!s.running&&s.renderer?.active===false,backend:f?.backend,simGrid:f?.simGrid,raySteps:f?.volumePresentationReceipt?.effectiveRayQuality?.raySteps,width:f?.width,height:f?.height,raw:f};})()`);
    }
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
      if(browser){
        if(v['inspect-controls']||report.decodeAfter){
          const previews=report.inspection?.previews??await browser.evaluate('window.flux3SmokePreviews??[]').catch(()=>[]);
          for(const p of previews){if(p.png){p.file=`preview-step-${p.step}.png`;await fs.writeFile(path.join(out,p.file),Buffer.from(p.png,'base64'));delete p.png;}}
          if(!report.inspection)report.partialPreviews=previews;
        }
        if(!report.load)report.load=await browser.evaluate('window.flux3SmokeLoad??null').catch(()=>null);
        await browser.close();
      }
      else if(report.ownedBrowserPid&&!report.browserExit)process.kill(report.ownedBrowserPid,'SIGTERM');
    }catch(error){report.cleanupError=String(error);report.ok=false;process.exitCode=1;}
    report.finishedAt=new Date().toISOString();await write();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
