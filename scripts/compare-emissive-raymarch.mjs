import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [root, base, input, out, zoom = '0.62', experiment = 'parity', pairCount = '32'] = process.argv.slice(2);
await fs.mkdir(out, {recursive:true});
const report = {status:'running',phase:'source',root,base,input,errors:[],arms:[]};
const save = () => fs.writeFile(out+'/report.json', JSON.stringify(report,null,2));
await save();
let browser,page;
process.on('SIGUSR2',async()=>{
  if(!page)return;
  report.diagnostic=await page.evaluate(()=>({volume:window.__kaminosVolumePrototype?.debugState(),camera:window.kaminosSceneEmissiveCameraDebugState?.(),gi:window.kaminosSceneGIDebugState?.()}));
  await save();
});
try {
  report.runtime = await (await fetch(base+'/api/runtime-config')).json();
  assert.equal(report.runtime.source.repoRoot,root);
  const scene = JSON.parse(await fs.readFile(input+'/scene.kaminos.json'));
  const {compositionRestoreUrl} = await import(pathToFileURL(root+'/scene-authoring.mjs'));
  report.url = compositionRestoreUrl(scene.composition,'refractory-kiln_2026-10-07_13-22-21_4a32a50deb7244db8da432faa5340747.kaminos.json',base);
  await fs.copyFile(input+'/basin.json',out+'/source-basin.json');
  await fs.copyFile(input+'/scene.kaminos.json',out+'/source-scene.json');
  await fs.copyFile(root+'/scripts/compare-emissive-raymarch.mjs',out+'/driver.mjs');
  report.playwrightModule=process.env.PLAYWRIGHT_MODULE;
  report.executable=process.env.CHROMIUM_EXECUTABLE;
  assert.ok(report.playwrightModule && report.executable,'caller supplies independent browser and Playwright module paths');
  const {chromium} = await import(pathToFileURL(report.playwrightModule));
  browser = await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page = await browser.newPage({viewport:{width:1300,height:950}});
  page.setDefaultTimeout(0);
  page.on('pageerror',e=>{report.errors.push(String(e));void save();});
  page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void save();}});
  page.on('response',r=>{if(r.status()>=400){report.errors.push(r.status()+' '+r.url());void save();}});
  report.phase='load';await save();await page.goto(report.url);
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().active||window.__kaminosVolumePrototype?.debugState().error);
  assert.equal(await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().error),null);
  await page.evaluate(()=>window.__kaminosVolumePrototype.setDebugRaymarchShaderSpecialization('force-full'));
  await page.waitForFunction(()=>window.kaminosSceneAuthoring?.read().objects.length>=3||/load failed/i.test(document.getElementById('info-bar')?.textContent||''));
  assert.equal(await page.evaluate(()=>window.kaminosSceneAuthoring.read().objects.length),scene.objects.length);
  report.camera=await page.evaluate(factor=>{
    const original=window.kaminosCameraDebugState();
    const position=original.position.map((x,i)=>original.target[i]+(x-original.target[i])*factor);
    return {original,effective:window.kaminosSetCameraDebugPose({position,target:original.target}),zoom:factor};
  },Number(zoom));
  report.phase='scene-camera';await save();
  await page.screenshot({path:out+'/before-match-scene.png'});
  await page.evaluate(()=>{const el=document.getElementById('rendering-match-flame-camera');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>window.kaminosSceneEmissiveCameraDebugState?.().effective);
  report.sceneCamera=await page.evaluate(()=>window.kaminosSceneEmissiveCameraDebugState());
  await page.screenshot({path:out+'/matched-agx-scene.png'});
  report.phase='settling';
  report.beforeSettle=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());await save();
  await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>150);
  report.frozen=await page.evaluate(()=>{window.__kaminosVolumePrototype.setSimulationPaused(true);return window.__kaminosVolumePrototype.debugState();});
  assert.equal(report.frozen.controls.toneMapping,'agx');
  assert.equal(report.frozen.physicalColor.effective,'emissive-transport-v2');
  assert.equal(report.frozen.backend,'WebGPU:apple');
  report.phase='held-comparison';await save();
  const arms = [['full','force-full'],['lean','auto'],['lean-repeat','auto'],['full-repeat','force-full']];
  for(const [label,specialization] of arms) {
    report.phase=label;await save();
    const arm=await page.evaluate(async({specialization,step})=>{
      const mode = 'agx', ev = 0;
      const r=window.__kaminosVolumePrototype;
      for(const [id,value] of [['volume-tone-mapping',mode],['volume-physical-exposure',ev],['rendering-match-flame-camera',true]]){
        const el=document.getElementById(id);
        if(el.type==='checkbox')el.checked=value;else el.value=String(value);
        el.dispatchEvent(new Event('change',{bubbles:true}));
        el.dispatchEvent(new Event('input',{bubbles:true}));
      }
      r.setDebugRaymarchShaderSpecialization(specialization);
      const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
      const state=r.debugState();
      if(!sample.ok||state.simStepCount!==step||state.controls.toneMapping!==mode||state.physicalColor.toneMapping!==mode)throw Error('wrong/missing camera comparison arm');
      const expected = specialization === 'auto' ? 'lean-emissive-raymarch-v0' : 'full-authored-raymarch-v0';
      if(state.raymarchShaderSpecialization.effective !== expected)throw Error('wrong/missing actual raymarch specialization');
      const frame=sample.image;
      if(!frame || frame.rgba.length!==frame.width*frame.height*4 || !frame.rgba.some((v,i)=>i%4!==3 && v>0))throw Error('missing, partial, or blank frame');
      const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
      canvas.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(frame.rgba),frame.width,frame.height),0,0);
      return {mode,ev,state,width:frame.width,height:frame.height,rgba:frame.rgba,png:canvas.toDataURL('image/png'),sample:{...sample,image:null,preview:null}};
    },{specialization,step:report.frozen.simStepCount});
    const bytes=Buffer.from(arm.rgba);
    await fs.writeFile(out+'/'+label+'.rgba',bytes);
    await fs.writeFile(out+'/'+label+'.png',Buffer.from(arm.png.split(',')[1],'base64'));
    await page.screenshot({path:out+'/'+label+'-scene.png'});
    report.arms.push({label,...arm,rgba:undefined,png:undefined,sha256:createHash('sha256').update(bytes).digest('hex')});await save();
  }
  for(const arm of report.arms) assert.equal(arm.sha256,report.arms[0].sha256,'full and lean must reproduce the same held pixels');
  assert.equal(report.errors.length,0,'native route and shader errors');
  if(experiment === 'timing') {
    report.phase='camera-raster-timing'; await save();
    const count=Number(pairCount);
    assert.ok(Number.isInteger(count) && count>0,'caller pair count is a positive integer');
    report.profiles=[];
    for(let pair=0;pair<count;pair++) {
      for(const specialization of pair%2 ? ['auto','force-full'] : ['force-full','auto']) {
        const profile=await page.evaluate(async specialization=>{
          const r=window.__kaminosVolumePrototype;
          r.setDebugRaymarchShaderSpecialization(specialization);
          return r.sampleEmissiveRaymarchProfile({now:4000});
        },specialization);
        assert.equal(profile.ok,true,JSON.stringify(profile));
        assert.equal(profile.backend,'WebGPU:apple');
        assert.equal(profile.simStepCount,report.frozen.simStepCount);
        assert.equal(profile.scope,'camera-raymarch-raster-only-not-lighting-simulation-or-frame');
        assert.equal(profile.raymarchShaderSpecialization.effective,specialization==='auto'?'lean-emissive-raymarch-v0':'full-authored-raymarch-v0');
        assert.equal(profile.incidentLight.model,'distributed-volume-direct-radiance-v0');
        report.profiles.push({pair,specialization,...profile});await save();
      }
    }
    const median=values=>{const sorted=values.toSorted((a,b)=>a-b);return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2;};
    const full=median(report.profiles.filter(x=>x.specialization==='force-full').map(x=>x.ms));
    const lean=median(report.profiles.filter(x=>x.specialization==='auto').map(x=>x.ms));
    report.timing={pairCount:count,fullMedianMs:full,leanMedianMs:lean,reduction:1-lean/full};
  }
  assert.equal(report.errors.length,0,'native route and shader errors');
  report.status='observed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await save();await browser?.close();}
