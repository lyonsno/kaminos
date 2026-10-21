import {chromium} from '/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [origin,input,out,...modes]=process.argv.slice(2);
const captured=JSON.parse(await readFile(input,'utf8'));
const executablePath='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report={status:'failed',phase:'source',origin,input,executablePath,arms:[],errors:[]};
await mkdir(out,{recursive:true});let browser,page;
try{
 report.runtime=await(await fetch(origin+'/api/runtime-config')).json();
 report.sourceHashes={};
 for(const file of ['volume-core.js','volume-pressure-resolution.mjs','volume-open-boundary.mjs']){
  const response=await fetch(origin+'/'+file);assert.ok(response.ok);
  report.sourceHashes[file]=createHash('sha256').update(await response.text()).digest('hex');
 }
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 for(const mode of modes.length?modes:['half','off']){
  page=await browser.newPage({viewport:{width:900,height:700}});page.setDefaultTimeout(120000);
  page.on('pageerror',e=>report.errors.push(e.message));
  // Replay the captured coefficients, not the old URL's preset authority or
  // asynchronous scene restore. The original URL remains in the input receipt.
  const url=new URL('/?kaminos_volume_smoke=1&workspace=authoring&authoring=1&volume_steps=8&volume_render_scale=.25',origin);
  report.phase='load-'+mode;await page.goto(url.href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState?.().simStepCount>2&&window.kaminosFlameAuthoring);
  report.phase='apply-'+mode;
  const applied=await page.evaluate(({settings,mode})=>{
   const next=window.kaminosFlameAuthoring.read();
   for(const group of ['domControls','rendererControls','presentationControls'])
    for(const id of Object.keys(next[group]||{}))if(settings[group]?.[id])next[group][id]=settings[group][id];
   next.source=null;next.sourcePose=settings.sourcePose;
   for(const [id,value] of [['volume-steps',8],['volume-render-scale',.25],['volume-pressure-resolution',mode]]){
    const d=next.domControls[id];if(d){d.value=value;if('rawValue'in d)d.rawValue=String(value);}
   }
   window.kaminosFlameAuthoring.apply(next,'Replay captured zero-wind failure');
   document.getElementById('volume-pressure-resolution').dispatchEvent(new Event('change',{bubbles:true}));
   return window.kaminosFlameAuthoring.read();
  },{settings:captured.settings,mode});
  const arm={mode,applied,samples:[]};report.arms.push(arm);
  await page.waitForFunction(mode=>window.__kaminosVolumePrototype.debugState().pressureResolution.effective===mode,mode);
  arm.effective=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
  arm.controlDifferences=Object.entries(captured.state.controls).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(arm.effective.controls[key])).map(([key,value])=>({key,captured:value,effective:arm.effective.controls[key]}));
  assert.equal(arm.effective.controls.windStrength,0);
  assert.equal(arm.effective.controls.immersedPitch,captured.state.controls.immersedPitch);
  const initial=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);
  for(const steps of [128,512]){
   report.phase=mode+'-'+steps;
   await page.waitForFunction(n=>{const s=window.__kaminosVolumePrototype.debugState();if(s.error)throw Error(s.error);return s.simStepCount>=n;},initial+steps);
   const fields=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleReactantFields());
   assert.ok(fields.ok);await writeFile(out+'/'+mode+'-'+steps+'-fields.json',JSON.stringify(fields));
   const bytes=Buffer.from(fields.fluidBase64,'base64'),data=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
   const mean=[0,0,0],top=[0,0,0];let nt=0,heat=0,hotY=0;
   for(let i=0;i<data.length/16;i++){const y=Math.floor(i/fields.grid[0])%fields.grid[1];for(let a=0;a<3;a++){mean[a]+=data[i*16+a];if(y>=fields.grid[1]*.75)top[a]+=data[i*16+a];}if(y>=fields.grid[1]*.75)nt++;heat+=data[i*16+5];hotY+=data[i*16+1]*data[i*16+5];}
   const state=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState());
   arm.samples.push({steps:state.simStepCount,mean:mean.map(v=>v/(data.length/16)),top:top.map(v=>v/nt),hotY:hotY/heat,state});
   assert.equal(state.controls.windStrength,0);assert.equal(state.pressureResolution.effective,mode);
   assert.deepEqual(state.controls,arm.effective.controls,'Controls changed during replay');
   await page.screenshot({path:out+'/'+mode+'-'+steps+'.png'});
   await writeFile(out+'/progress.json',JSON.stringify(report));
  }
  await page.close();page=null;
 }
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.error=error.stack;process.exitCode=1;if(page){report.final=await page.evaluate(()=>({state:window.__kaminosVolumePrototype?.debugState?.(),body:document.body.innerText})).catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{await browser?.close();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,arms:report.arms.map(a=>({mode:a.mode,samples:a.samples.map(s=>({steps:s.steps,mean:s.mean,top:s.top,hotY:s.hotY}))}))}));}
