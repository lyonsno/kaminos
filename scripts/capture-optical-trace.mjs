import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compositionRestoreUrl} from '../scene-authoring.mjs';

const [root,input,out,portText,subdivisionText]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={identity:'ordered-optical-capture-conformance-v0',status:'running',phase:'inputs',root,input,
  claim:'three scanline implementation witness; not the training corpus or an image-quality result',errors:[],chunks:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
await save();
let server,browser,page;
try {
  const port=Number(portText),subdivisions=Number(subdivisionText);
  assert.ok(Number.isInteger(port)&&port>0&&Number.isInteger(subdivisions)&&subdivisions>0);
  report.source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  report.diff=execFileSync('git',['diff','HEAD'],{cwd:root,encoding:'utf8'});
  const basin=JSON.parse(await fs.readFile(input+'/basin.json','utf8'));
  const scene=JSON.parse(await fs.readFile(input+'/scene.kaminos.json','utf8'));
  await fs.mkdir(out+'/settings/presets',{recursive:true});
  await fs.mkdir(out+'/scenes',{recursive:true});
  await fs.copyFile(input+'/basin.json',out+`/settings/presets/${basin.presetId}.json`);
  await fs.copyFile(input+'/scene.kaminos.json',out+'/scenes/optical-trace.kaminos.json');
  await fs.copyFile(input+'/basin.json',out+'/source-basin.json');
  await fs.copyFile(input+'/scene.kaminos.json',out+'/source-scene.json');
  report.executable=process.env.CHROMIUM_EXECUTABLE;
  report.playwright=process.env.PLAYWRIGHT_MODULE;
  assert.ok(report.executable?.includes('Google Chrome for Testing')||report.executable?.includes('headless_shell'),'independent test browser required');
  const {chromium}=await import(pathToFileURL(report.playwright));
  report.phase='server';await save();
  server=spawn('python3',['-u','serve.py',String(port),'--no-shared-basin-store','--volume-settings-store',out+'/settings'],
    {cwd:root,env:{...process.env,KAMINOS_SCENES_DIR:out+'/scenes'}});
  server.stdout.pipe(createWriteStream(out+'/server.stdout.log'));
  server.stderr.pipe(createWriteStream(out+'/server.stderr.log'));
  const base=`http://127.0.0.1:${port}`;
  for(;;){
    if(server.exitCode!==null)throw new Error(`server exited ${server.exitCode}`);
    try{report.runtime=await (await fetch(base+'/api/runtime-config')).json();break;}catch{await new Promise(r=>setTimeout(r,100));}
  }
  assert.equal(report.runtime.source.repoRoot,root,'wrong served checkout');
  browser=await chromium.launch({headless:true,executablePath:report.executable,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  page=await browser.newPage({viewport:{width:1300,height:950}});page.setDefaultTimeout(0);
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  report.url=compositionRestoreUrl(scene.composition,'optical-trace.kaminos.json',base);
  report.phase='load';await save();await page.goto(report.url);
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().active||window.__kaminosVolumePrototype?.debugState().error);
  assert.equal(await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().error),null);
  // Arm the internal exact-step hold before asynchronous scene settling can pass it.
  await page.evaluate(()=>{window.opticalTraceHold=window.__kaminosVolumePrototype.pauseSelectiveHeadLiveAtSimStep(151);});
  await page.waitForFunction(()=>window.kaminosSceneAuthoring?.read().objects.length>=3||/load failed/i.test(document.getElementById('info-bar')?.textContent||''));
  assert.equal(await page.evaluate(()=>window.kaminosSceneAuthoring.read().objects.length),scene.objects.length);
  report.hold=await page.evaluate(()=>window.opticalTraceHold);assert.equal(report.hold.ok,true,JSON.stringify(report.hold));
  report.phase='baseline';await save();
  const baseline=await page.evaluate(async()=>{
    const r=window.__kaminosVolumePrototype;
    const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
    if(!sample.ok||!sample.image)throw new Error('missing baseline');
    return {state:r.debugState(),image:sample.image};
  });
  report.state=baseline.state;
  assert.equal(report.state.backend,'WebGPU:apple');
  assert.equal(report.state.simStepCount,151);
  assert.equal(report.state.physicalColor.effective,'emissive-transport-v2');
  assert.equal(report.state.controls.toneMapping,'agx');
  const {width,height,rgba}=baseline.image;
  await fs.writeFile(out+'/baseline.rgba',Buffer.from(rgba));
  await page.screenshot({path:out+'/baseline-scene.png'});
  assert.ok(rgba.some((v,i)=>i%4!==3&&v>0),'blank baseline');
  for(const fraction of [0.25,0.5,0.75]) {
    let reference;
    for(const specialization of ['force-full','auto']) {
      report.phase=`trace-${fraction}-${specialization}`;await save();
      const chunk=await page.evaluate(async options=>{
        const result=await window.__kaminosVolumePrototype.sampleOpticalTraceChunk(options);
        if(!result.ok)throw new Error(JSON.stringify(result));
        return {...result,values:Array.from(result.values)};
      },{firstRay:Math.floor(height*fraction)*width,rayCount:width,sampleOffset:0,sampleCount:subdivisions+1,subdivisions,now:4000,specialization});
      const bytes=Buffer.from(new Float32Array(chunk.values).buffer);
      const path=`trace-${fraction}-${specialization}.f32`;
      await fs.writeFile(out+'/'+path,bytes);
      const sha256=createHash('sha256').update(bytes).digest('hex');
      report.chunks.push({...chunk,values:undefined,path,sha256});await save();
      if(reference)assert.ok(bytes.equals(reference),'full and lean optical coefficients differ');
      else reference=bytes;
    }
  }
  const after=await page.evaluate(async()=>{
    const r=window.__kaminosVolumePrototype;
    const sample=await r.sampleFrame({advanceSim:false,includeRgba:true,now:4000});
    if(!sample.ok)throw new Error(JSON.stringify(sample));
    return sample.image;
  });
  assert.ok(Buffer.from(after.rgba).equals(Buffer.from(rgba)),'capture changed ordinary held pixels');
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  assert.ok(report.chunks.some(c=>c.counts.validRows>0),'all captured rays missed');
  report.status='observed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{
  await save();await browser?.close();
  if(server&&server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}
}
