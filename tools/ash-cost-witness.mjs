import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {resolve} from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';import {validateAshCostReport} from './ash-cost-contracts.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out')),repo=resolve(args.get('--repo')),origin=args.get('--url'),mode=args.get('--mode')??'cells',width=Number(args.get('--width')??7.68),samples=Number(args.get('--samples')??12);
mkdirSync(out,{recursive:true});const r={status:'running',phase:'source',route:'shared-webgpu-pass-timestamps',requested:{mode,width,samples},errors:[],consoleErrors:[],cases:{}};let browser,page;const save=()=>writeFileSync(out+'/report.json',JSON.stringify(r,null,2));save();
const source=()=>createHash('sha256').update(['ash/fall-gpu.mjs','ash/fall-plan.mjs','ash/scan-wgsl.mjs','ash/tile-gpu.mjs','ash/gpu-plan.mjs','ash/scene-gpu.mjs','ash/tile-plan.mjs','experiments/ash-gpu-deposition.experiment.mjs','tools/ash-pass-timer.mjs','tools/ash-cost-witness.mjs','tools/ash-cost-contracts.mjs'].map(p=>readFileSync(repo+'/'+p)).join('\n')).digest('hex');
try{
 assert.ok(Number.isInteger(samples)&&samples>0);r.sourceBefore=source();r.server=await verifyAuthoringServer({origin,repoRoot:repo});
 const {chromium}=await import(args.get('--playwright'));r.browserExecutable=args.get('--browser');assert.match(r.browserExecutable,/Chrome for Testing|chromium/);
 browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:r.browserExecutable,headless:true,viewport:{width:1440,height:1000},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal']});page=browser.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',e=>r.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')r.consoleErrors.push(m.text());});
 await page.addInitScript(()=>{const request=GPUAdapter.prototype.requestDevice;window.__ashDevices=[];GPUAdapter.prototype.requestDevice=async function(...args){const d=await request.apply(this,args);window.__ashDevices.push(d);return d;};});
 const url=new URL('/?workspace=workbench&experiment=ash-tiled-landscape',origin);url.searchParams.set('experiment_inputs',JSON.stringify({width,surfaceMode:mode}));r.url=url.href;r.phase='mount';save();await page.goto(url.href);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-tiled-landscape'||document.body.innerText.includes('Experiments unavailable'));assert.equal(await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id),'ash-tiled-landscape');
 const invoke=(n,v)=>page.evaluate(([n,v])=>window.kaminosWorkbenchExperiments.invoke(n,v),[n,v]);await invoke('play',false);await invoke('cloudPlay',false);await invoke('contactEnabled',false);
 r.device=await page.evaluate(async()=>{if(window.__ashDevices.length!==1)throw Error('Ambiguous shared device');const d=window.__ashDevices[0];window.__ashTimer=(await import('/tools/ash-pass-timer.mjs')).installAshPassTimer(d);window.__ashInspectionEnd=window.__kaminosBeginSceneInspection();return {features:[...d.features],limits:{maxStorageBufferBindingSize:d.limits.maxStorageBufferBindingSize,maxBufferSize:d.limits.maxBufferSize}};});
 r.initial=await invoke('read');r.effective={mode:r.initial.surfaceMode??'cells',width:r.initial.layout.bounds.max[0]-r.initial.layout.bounds.min[0]};assert.deepEqual(r.effective,{mode,width});
 const g=r.initial.identity.groundY,id=r.initial.sceneObjectIds.find(x=>x.name==='Fallen timber').id;
 await invoke('advance',{steps:8});
 const frame=async name=>{await page.evaluate(()=>window.__kaminosRenderSceneForInspection());await invoke('settleFrame');await page.screenshot({path:out+'/'+name+'.png'});};
 for(const name of ['settled','moving']){
  r.phase=name;r.cases[name]={samples:[]};save();
  for(let i=0;i<samples+2;i++){
   if(name==='moving')await page.evaluate(({id,x,g})=>window.kaminosSetSceneObjectTransform(id,{position:[x,g+.125,1.8]}),{id,g,x:1.8-i*.08});
   const compute=await page.evaluate(()=>window.__ashTimer.measure(()=>window.kaminosWorkbenchExperiments.invoke('advance',{steps:1})));
   // Three's FRAME nodes update on its internal RAF. A second render in the
   // same frame only presents cached textures, even though the draw returns true.
   const render=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));let frame;const timing=await window.__ashTimer.measure(()=>{frame=window.__kaminosRenderSceneForInspection();});return {...timing,frame};});
   if(i>=2)r.cases[name].samples.push({compute,render});
  }
  r.cases[name].diagnostics=await invoke('diagnostics');r.cases[name].state=await invoke('read');await frame(name);const checkpoint=await invoke('snapshot');writeFileSync(out+'/'+name+'-checkpoint.json',JSON.stringify(checkpoint));save();
 }
 r.sourceAfter=source();r.status='passed';r.phase='complete';
}catch(e){r.status='failed';r.error=String(e.stack??e);process.exitCode=1;if(page)await page.screenshot({path:out+'/failed.png'}).catch(()=>{});}finally{if(page)await page.evaluate(()=>{window.__ashTimer?.dispose();window.__ashInspectionEnd?.();}).catch(()=>{});await browser?.close();r.browserClosed=true;if(r.status==='passed')try{validateAshCostReport(r);}catch(e){r.status='failed';r.error=String(e.stack??e);process.exitCode=1;}save();console.log(JSON.stringify({status:r.status,phase:r.phase,error:r.error,out}));}
