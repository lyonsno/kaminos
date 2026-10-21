import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const options=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v.replace(/^--/,''),all[i+1]]],[]));
const out=path.resolve(options.out??'scratch/contact-witness');fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'arguments',requested:options,frames:[],pageErrors:[],consoleErrors:[],browserClosed:false};const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();
let context,page;
try{
 if(!options.url||!options.browser||!options.playwright||!options.root||!options.revision)throw Error('Explicit URL, independent browser, Playwright, root and revision required');
 if(/\/Applications\/Google Chrome\.app\//.test(options.browser)||!fs.existsSync(options.browser))throw Error('An existing independent automation browser is required');
 report.phase='source';save();const runtime=await(await fetch(new URL('/api/runtime-config',options.url))).json();report.runtime=runtime;
 if(runtime.source?.repoRoot!==options.root||runtime.source?.commit!==options.revision||runtime.source?.dirty!==false)throw Error('Wrong, stale or dirty source route');
 const {chromium}=await import(options.playwright);report.phase='browser';save();
 context=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:options.browser,headless:true,viewport:{width:1440,height:1050},args:['--use-mock-keychain','--password-store=basic'],timeout:0});
 context.setDefaultTimeout(0);page=context.pages()[0]??await context.newPage();
 let rejectFailure;const failure=new Promise((_,reject)=>{rejectFailure=reject;});failure.catch(()=>{});
 page.on('pageerror',e=>{report.pageErrors.push(e.message);rejectFailure(Error(e.message));});page.on('console',m=>{if(m.type()==='error'){report.consoleErrors.push(m.text());rejectFailure(Error(m.text()));}});
 report.phase='page-load';save();await page.goto(options.url,{waitUntil:'domcontentloaded',timeout:0});
 await Promise.race([page.waitForFunction(()=>{
  const s=document.querySelector('.owner-experiment-status')?.textContent??'';
  return window.kaminosWorkbenchExperiments?.state().id==='creature-flesh/contact'||(s&&!s.startsWith('Opening')&&s!=='Creature · contact and recovery');
 },null,{timeout:0}),failure]);
 if(await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id)!=='creature-flesh/contact')throw Error(await page.locator('.owner-experiment-status').textContent());
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 report.initial=await page.evaluate(()=>window.kaminosCreatureFlesh.read());
 if(report.initial.deformer.backend!=='webgpu-dense-dq'||!report.initial.deformer.allInfluences||report.initial.deformer.dispatches<1||report.initial.error)throw Error('Missing actual GPU skin / physical owner');
 report.phase='initial-capture';await page.screenshot({path:path.join(out,'initial.png')});
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('volume',true));await page.screenshot({path:path.join(out,'volume.png')});await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('volume',false));
 if(options.mode!=='static'){
  report.phase='contact-stroke';save();
  if(options.mode==='motion')await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('motion',true));
  await page.evaluate(async()=>{await window.kaminosWorkbenchExperiments.invoke('replay');await window.kaminosWorkbenchExperiments.invoke('play',false);});
  fs.mkdirSync(path.join(out,'frames'),{recursive:true});
  for(let i=0;i<180;i++){
   const state=await page.evaluate(async()=>{await window.kaminosWorkbenchExperiments.invoke('advance',1);return window.kaminosCreatureFlesh.read({geometry:false});});
   if(state.steps!==i+1||state.error||!Number.isFinite(state.volume.volumeRatio)||!(state.volume.minJ>0))throw Error('Incomplete, stale or invalid physical step');
   const raw=await page.evaluate(()=>({state:window.kaminosCreatureFlesh.read(),points:window.kaminosCreatureFlesh.read({geometry:true}).physicalPoints,offsets:window.kaminosCreatureFlesh.read({geometry:true}).offsets}));
   const file=`frames/${String(i+1).padStart(4,'0')}.png`;await page.screenshot({path:path.join(out,file)});
   fs.writeFileSync(path.join(out,`frames/${String(i+1).padStart(4,'0')}.json`),JSON.stringify(raw));report.frames.push({file,step:state.steps,frame:state.frame,volume:state.volume});
  }
  report.phase='final-gpu-parity';save();
  const parity=await page.evaluate(async()=>{const gpu=await window.kaminosCreatureFlesh.gpu(),cpu=window.kaminosCreatureFlesh.geometry().attributes.position.array;let max=0;for(let i=0;i<cpu.length;i++)max=Math.max(max,Math.abs(cpu[i]-gpu.positions[i]));return{max,vertices:gpu.positions.length/3,layout:gpu.layout,backend:gpu.backend,positions:Array.from(gpu.positions)};});
  fs.writeFileSync(path.join(out,'gpu-positions.bin'),Buffer.from(Float32Array.from(parity.positions).buffer));delete parity.positions;report.parity=parity;if(!(parity.max<1e-4)||parity.vertices!==report.initial.body.vertices)throw Error('GPU skin differs from CPU current-shape consumer');
 }
 report.final=await page.evaluate(()=>window.kaminosCreatureFlesh.read());report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};if(page)try{await page.screenshot({path:path.join(out,'failure.png')});report.last=await page.evaluate(()=>({owner:window.kaminosWorkbenchExperiments?.state(),physical:window.kaminosCreatureFlesh?.read()}));}catch(e){report.failureCaptureError=e.message;}}
finally{if(context){await context.close();report.browserClosed=true;}save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,output:path.join(out,'report.json'),failure:report.failure?.message,frames:report.frames.length,browserClosed:report.browserClosed}));if(report.status!=='passed')process.exitCode=1;
