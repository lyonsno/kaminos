import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {checkOpticalStepGpu} from './check-optical-step-gpu.mjs';

const [root, base, input, out] = process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'source',root,base,input,arms:[],errors:[],claim:'native visual comparison; not isolated timing or continuous-field accuracy'};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
await save();
let browser,page;
try {
  report.source={head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
  const files=['volume-core.js','volume-optical-native.mjs','index.html','scripts/preview-optical-stepping.mjs','scripts/check-optical-step-gpu.mjs'];
  report.source.files=[];
  for (const file of files) {
    const bytes=await fs.readFile(root+'/'+file);
    await fs.writeFile(out+'/'+file.replaceAll('/','_'),bytes);
    report.source.files.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  report.runtime=await (await fetch(base+'/api/runtime-config')).json();
  assert.equal(report.runtime.source.repoRoot,root);
  const scene=JSON.parse(await fs.readFile(input+'/scene.kaminos.json'));
  const {compositionRestoreUrl}=await import(pathToFileURL(root+'/scene-authoring.mjs'));
  report.url=compositionRestoreUrl(scene.composition,'refractory-kiln_2026-10-07_13-22-21_4a32a50deb7244db8da432faa5340747.kaminos.json',base)+'&volume_light_field_optical_preview=1';
  for(const file of ['basin.json','scene.kaminos.json'])await fs.copyFile(input+'/'+file,out+'/source-'+file);
  report.executable=process.env.CHROMIUM_EXECUTABLE;
  report.playwrightModule=process.env.PLAYWRIGHT_MODULE;
  assert.ok(report.executable?.includes('Google Chrome for Testing'),'independent browser required');
  const {chromium}=await import(pathToFileURL(report.playwrightModule));
  browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page=await browser.newPage({viewport:{width:1300,height:950}});
  page.setDefaultTimeout(0);
  page.on('pageerror',e=>{report.errors.push(String(e));void save();});
  page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void save();}});
  page.on('response',r=>{if(r.status()>=400){report.errors.push(r.status()+' '+r.url());void save();}});
  report.phase='load';await save();await page.goto(report.url);
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().active||window.__kaminosVolumePrototype?.debugState().error);
  assert.equal(await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().error),null);
  await page.waitForFunction(()=>window.kaminosSceneAuthoring?.read().objects.length>=3||/load failed/i.test(document.getElementById('info-bar')?.textContent||''));
  assert.equal(await page.evaluate(()=>window.kaminosSceneAuthoring.read().objects.length),scene.objects.length);
  await page.evaluate(()=>{
    const pose=window.kaminosCameraDebugState();
    window.kaminosSetCameraDebugPose({position:pose.position.map((x,i)=>pose.target[i]+(x-pose.target[i])*0.62),target:pose.target});
    const el=document.getElementById('rendering-match-flame-camera');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  report.phase='settling';await save();
  await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>150);
  report.frozen=await page.evaluate(()=>{const r=window.__kaminosVolumePrototype;r.setSimulationPaused(true);r.setControls({lookFreeze:1});return r.debugState();});
  assert.equal(report.frozen.backend,'WebGPU:apple');
  assert.equal(report.frozen.controls.toneMapping,'agx');
  assert.equal(report.frozen.physicalColor.effective,'emissive-transport-v2');
  report.phase='gpu-arithmetic';await save();await checkOpticalStepGpu(page,async values=>{report.gpuArithmetic=values;await save();});
  report.frozenCamera=await page.evaluate(()=>window.kaminosCameraDebugState());
  for(const [label,value,orbit=0] of [['current','current'],['fixed','fixed'],['numerical','numerical:0.001'],['numerical-loose','numerical:0.01'],['fixed-dense','fixed-dense'],['orbit-fixed','fixed',0.15],['orbit-numerical','numerical:0.001',0.15],['current-repeat','current']]) {
    report.phase=label;await save();
    const arm=await page.evaluate(async({value,step,camera,orbit})=>{
      const r=window.__kaminosVolumePrototype;
      const d=camera.position.map((x,i)=>x-camera.target[i]);
      const position=[camera.target[0]+d[0]*Math.cos(orbit)+d[2]*Math.sin(orbit),camera.position[1],camera.target[2]+d[2]*Math.cos(orbit)-d[0]*Math.sin(orbit)];
      window.kaminosSetCameraDebugPose({position,target:camera.target});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const el=document.getElementById('optical-stepping-preview');
      el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));
      if(!el.checkValidity()||el.value!==value)throw Error('comparison selector refused requested arm');
      const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
      const state=r.debugState(),frame=sample.image;
      const {validateOpticalPreviewArm}=await import('/volume-optical-native.mjs');
      validateOpticalPreviewArm(sample,state,{mode:value.split(':')[0],tolerance:Number(value.split(':')[1]||0.001),step});
      const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
      canvas.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(frame.rgba),frame.width,frame.height),0,0);
      return {state,width:frame.width,height:frame.height,rgba:frame.rgba,png:canvas.toDataURL('image/png')};
    },{value,step:report.frozen.simStepCount,camera:report.frozenCamera,orbit});
    const bytes=Buffer.from(arm.rgba);
    await fs.writeFile(out+'/'+label+'.rgba',bytes);
    await fs.writeFile(out+'/'+label+'.png',Buffer.from(arm.png.split(',')[1],'base64'));
    await page.screenshot({path:out+'/'+label+'-scene.png'});
    report.arms.push({label,orbit,...arm,rgba:undefined,png:undefined,sha256:createHash('sha256').update(bytes).digest('hex')});await save();
  }
  assert.equal(report.arms.at(-1).sha256,report.arms[0].sha256,'return to current must reproduce held pixels');
  assert.notEqual(report.arms[1].sha256,report.arms[0].sha256,'reference must not silently return current pixels');
  assert.equal(report.errors.length,0,'native errors');
  await page.locator('[data-workspace-mode="workbench"]').click();
  await page.locator('.tab[data-tab="volume"]').click();
  await page.locator('#optical-stepping-preview').scrollIntoViewIfNeeded();
  await page.screenshot({path:out+'/comparison-control.png'});
  report.status='observed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await save();await browser?.close();}
