import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
import {acceptAshFlameRaster} from './ash-cloud-contracts.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out')),repo=resolve(args.get('--repo')),origin=args.get('--url'),profile=args.get('--profile')==='yes',width=Number(args.get('--width')??1440),height=Number(args.get('--height')??1000);
mkdirSync(out,{recursive:true});let browser,page;
const report={status:'running',phase:'identity',requested:{origin,repo,profile,dpr:Number(args.get('--dpr')??1)},errors:[],consoleErrors:[],frames:[],interventions:[]};
const write=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));write();
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
try{
 report.server=await verifyAuthoringServer({origin,repoRoot:repo});report.hashes={};
 for(const path of ['index.html','volume-core.js','ash/atmosphere-plan.mjs','ash/atmosphere-gpu.mjs','experiments/ash-scene-cloud.experiment.mjs','tools/ash-cloud-witness.mjs','tools/ash-cloud-contracts.mjs']){const response=await fetch(new URL(path,origin));assert.ok(response.ok,path);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(readFileSync(resolve(repo,path))));report.hashes[path]=hash(readFileSync(resolve(repo,path)));}
 report.launch=fluidBrowserLaunch({executable:args.get('--browser'),debugPort:0,userDataDir:resolve(out,'profile'),width,height});
 const {chromium}=await import(args.get('--playwright'));browser=await chromium.launchPersistentContext(resolve(out,'profile'),{executablePath:report.launch.executable,headless:true,viewport:{width,height},deviceScaleFactor:report.requested.dpr,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 if(args.get('--negative-hidden')==='yes'){
  const original=readFileSync(resolve(repo,'ash/atmosphere-gpu.mjs'),'utf8'),injected=original.replace('material.opacityNode=grainMask.mul(opacity).mul(', 'material.opacityNode=float(0).mul(');assert.notEqual(injected,original);report.injection={kind:'hidden fine flakes',original:hash(original),effective:hash(injected)};writeFileSync(resolve(out,'injected-atmosphere.mjs'),injected);await browser.route('**/ash/atmosphere-gpu.mjs',route=>route.fulfill({status:200,contentType:'text/javascript',body:injected}));
 }
 page=browser.pages()[0];page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const invoke=async(name,input)=>{report.interventions.push({name,input});write();return page.evaluate(([n,i])=>window.kaminosWorkbenchExperiments.invoke(n,i),[name,input]);};
 const url=new URL('/?workspace=workbench&experiment=ash-scene-cloud',origin);url.searchParams.set('ash_timing',profile?'1':'0');report.requested.url=url.href;
 report.phase='mount';write();page.setDefaultTimeout(0);await page.goto(url.href);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-scene-cloud'||document.body.innerText.includes('Experiments unavailable:'));assert.equal(await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id),'ash-scene-cloud');
 await invoke('play',false);await invoke('cloudTime',10);await invoke('wide');report.initial=await invoke('read');assert.equal(report.initial.atmosphere.backend,'webgpu-analytic-haze-and-vertex-flakes');assert.equal(report.initial.atmosphere.settings.count,24000);assert.equal(report.initial.atmosphere.computeDispatches,0);
 const settle=async()=>{await page.evaluate(async()=>{for(let n=0;n<4;n++)await new Promise(requestAnimationFrame);});await invoke('settleFrame');};
 const capture=async name=>{await settle();const state=await invoke('read');assert.deepEqual(state.errors,[]);await page.screenshot({path:resolve(out,name+'.png')});const canvas=await page.locator('#kaminos-host-renderer-canvas').screenshot();writeFileSync(resolve(out,name+'-canvas.png'),canvas);report.frames.push({name,state});write();return canvas.toString('base64');};
 const delta=async(a,b)=>page.evaluate(async([a,b])=>{
  const decode=async value=>{const image=new Image();image.src='data:image/png;base64,'+value;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return {w:c.width,h:c.height,p:ctx.getImageData(0,0,c.width,c.height).data};};
  const A=await decode(a),B=await decode(b),bands=[0,0,0];let changed=0;
  if(A.w!==B.w||A.h!==B.h)throw Error('Canvas shape changed');
  // The lower HUD region is retained in raw PNG but cannot establish ash.
  for(let y=0;y<A.h*.85;y++)for(let x=0;x<A.w;x++){const i=(x+y*A.w)*4;const d=Math.max(...[0,1,2].map(k=>Math.abs(A.p[i+k]-B.p[i+k])));if(d>12){changed++;bands[Math.min(2,Math.floor(x/A.w*3))]++;}}
  return {changed,bands,width:A.w,height:A.h,excludedBottomFraction:.15};
 },[a,b]);
 report.phase='fine-pixels';await invoke('atmosphere',{density:0,count:0});const empty=await capture('00-no-flakes');await invoke('atmosphere',{count:24000});const fine=await capture('01-fine-flakes');report.fineDelta=await delta(empty,fine);assert.ok(report.fineDelta.changed>200,'fine flakes must appear in actual canvas');assert.ok(report.fineDelta.bands.every(n=>n>30),'ash must extend across all thirds of the view');
 await invoke('cloudTime',14);const moved=await capture('02-fine-motion');report.motionDelta=await delta(fine,moved);assert.ok(report.motionDelta.changed>200,'fine ash must move at a fixed camera');
 await invoke('atmosphere',{density:.018});await capture('03-cloud-and-haze');
 await invoke('deposit',{volume:.12,radius:.6});await invoke('advance',{steps:12});await invoke('burst',.03);await invoke('advance',{steps:12});await capture('04-local-deposit-and-fall');await invoke('moveContact',{position:[.4,report.initial.identity.groundY+.1,1]});await invoke('advance',{steps:8});await invoke('frame');await capture('05-close-contact');
 if(args.get('--basin')){
  report.phase='flame';report.requested.basin=args.get('--basin');report.requested.fireOverrides={'volume-resolution':32,'volume-grid-height-ratio':1,'volume-steps':8,'volume-render-scale':.3};report.flame=await invoke('flame',{presetId:args.get('--basin'),controls:report.requested.fireOverrides});await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState().simGrid===32);report.flame=await invoke('flame');assert.equal(report.flame.active,true);assert.equal(Number(report.flame.settings.domControls['volume-resolution'].value),32);assert.ok(Number(report.flame.settings.domControls['volume-steps'].value)<=8);assert.equal(report.flame.runtime.simGrid,32);report.flameAsh=await page.evaluate(()=>window.__kaminosVolumePrototype.sharedAshAtmosphere());assert.equal(report.flameAsh.density,.018);await page.evaluate(async()=>{for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);});report.flame=await invoke('flame');await capture('06-shared-flame');
 }
 if(profile){
  report.phase='profile';write();report.profiles=[];await invoke('wide');await invoke('cloudPlay',true);
  for(const [name,enabled,count,playing,emission] of [['off',false,24000,false,false],['haze',true,0,false,false],['cloud',true,24000,false,false],['off-repeat',false,24000,false,false],['cloud-repeat',true,24000,false,false],['combined',true,24000,true,true]]){
   await invoke('atmosphere',{enabled,count});await invoke('visibility',true);await invoke('emit',emission);await invoke('play',playing);await settle();await invoke('renderProfile');
   const samples=[];for(let n=0;n<36;n++){await page.evaluate(()=>new Promise(requestAnimationFrame));samples.push(await invoke('renderProfile'));}
   report.profiles.push({name,state:await invoke('read'),samples});write();
  }
  await invoke('play',false);await invoke('emit',false);await invoke('atmosphere',{enabled:true});await invoke('visibility',true);
  report.groundCompute=await invoke('profile',{samples:24});
  if(args.get('--basin')){
   report.phase='same-field-flame-profile';write();
   report.flameProfiles=await page.evaluate(async()=>{
    const {acceptAshFlameRaster}=await import('/tools/ash-cloud-contracts.mjs');
    const v=window.__kaminosVolumePrototype,original=v.sharedAshAtmosphere(),results=[],wasPaused=v.debugState().simulationPaused;
    v.setSimulationPaused(true);v.setSelectiveHeadLiveCapturePaused(true);let expected=null;
    try{for(const enabled of [false,true,false,true]){
     v.setSharedAshAtmosphere({...original,density:enabled?original.density:0});const samples=[];
     for(let n=0;n<24;n++){const r=await v.sampleEmissiveRaymarchProfile({now:10000});if(!acceptAshFlameRaster(r,expected))throw Error('Ordinary flame raster admission failed: '+JSON.stringify(r));expected??=r;samples.push(r);}
     results.push({enabled,samples});
    }}finally{v.setSharedAshAtmosphere(original);v.setSimulationPaused(wasPaused);v.setSelectiveHeadLiveCapturePaused(false);}return results;
   });write();
  }
 }
 if(report.flameProfiles)for(const arm of report.flameProfiles)for(const sample of arm.samples)assert.ok(acceptAshFlameRaster(sample,report.flameProfiles[0].samples[0]));
 report.phase='cleanup';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.lastPage=await page.evaluate(()=>({text:document.body.innerText,state:window.kaminosWorkbenchExperiments?.state()})).catch(String);await page.screenshot({path:resolve(out,'failed.png')}).catch(()=>{});}process.exitCode=1;
}finally{await browser?.close();report.browserClosed=true;write();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:resolve(out,'report.json')}));}
