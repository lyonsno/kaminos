import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const [url,out,playwrightPath,browserPath,sharedRoot]=process.argv.slice(2);
if(!out)throw Error('Caller-owned output directory required');
fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'setup',requestedUrl:url,checks:[],errors:[],observations:[],mount:'existing-stone-producer-not-shared-workbench'};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(name,passed,detail)=>{report.checks.push({name,passed,detail});save();if(!passed)throw Error(name);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let browser,page;
save();
try{
 const executable=fs.realpathSync(browserPath);if(executable.includes('/Google Chrome.app/'))throw Error('Independent headless executable required');
 report.source={root:process.cwd(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};
 report.shared={root:sharedRoot,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:sharedRoot,encoding:'utf8'}).trim()};
 check('exact observation kit',report.shared.revision==='603cb6b3b7915232bee100805ab75c757014c21f');
 const {chromium}=await import(pathToFileURL(playwrightPath));
 const {experiment}=await import(pathToFileURL(path.join(sharedRoot,'experiment-work.mjs'))),{observationSession}=await import(pathToFileURL(path.join(sharedRoot,'observation-session.mjs')));
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});report.browser={executable,version:browser.version()};
 const sources=['workbench-experiments.mjs','investigation-recording.mjs','structural-material-owner-entry.mjs','structural-material-owner-host.mjs','experiments/stone/stone-fracture.experiment.mjs','structural-material-shard-view.js'];
 report.source.hashes=Object.fromEntries(sources.map(name=>[name,hash(fs.readFileSync(name))]));
 for(const [name,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
  report.phase=`${name}-startup`;save();page=await browser.newPage({viewport});page.setDefaultTimeout(0);
  page.on('pageerror',error=>{report.errors.push({view:name,message:error.message});save();});
  await page.addInitScript(()=>{let api;Object.defineProperty(window,'__stoneShards',{get:()=>api,set(value){api=value;value.pause(true);},configurable:true});window.__ownerPointerInput=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])window.addEventListener(type,event=>window.__ownerPointerInput.push({type,x:event.clientX,y:event.clientY,at:performance.now()}),{capture:true});});
  await page.goto(url);await page.waitForFunction(()=>window.__stoneExperiment||document.getElementById('failure')?.textContent);
  check(`${name} contribution mounted`,await page.evaluate(()=>window.__stoneExperiment?.id==='stone/fracture'),await page.locator('#failure').textContent());
  for(const file of sources){const response=await page.request.get(new URL(file,url).href);check(`${name} source ${file}`,response.ok()&&hash(await response.body())===report.source.hashes[file]);}
  check(`${name} effective URL`,page.url()===url);
  await observationSession({out:path.join(out,name),source:{producer:report.source,shared:report.shared,url,viewport,mount:report.mount},capture:()=>page.screenshot(),exercise:async({retain})=>{
   const call=(operation,input)=>page.evaluate(async({operation,input})=>window.__stoneExperiment.invoke(operation,input),{operation,input});
   const runtime={settle:()=>call('hold'),read:()=>page.evaluate(async()=>({material:await window.__stoneExperiment.read(),recording:window.__stoneExperiment.recording()})),camera:view=>call('view',view),
    validate(state){if(state.material.backend!=='webgpu'||state.material.adapterFallback||state.material.connectivity!=='elastic-support'||!state.material.paused)throw Error('Unverified stone entry');},
    assertStable(before,after){if(JSON.stringify(after)!==JSON.stringify(before))throw Error('Stone owner operation changed during capture');}};
   // read() is an explicit cheap metadata/operation read, not physical-state evidence.
   const work=experiment({runtime,retain});await call('hold');await new Promise(resolve=>setTimeout(resolve,100));
   const initial=await work.observe('initial');report.observations.push({view:name,name:'initial',reference:initial});save();
   await page.locator('#threshold').evaluate(node=>{node.value='220';node.dispatchEvent(new Event('input',{bubbles:true}));});
   await page.waitForFunction(()=>window.__stoneShards.experimentStatus().threshold===220);
   await call('step',2);const after=await page.evaluate(()=>window.__stoneExperiment.read());check(`${name} same operation changes native step`,after.submittedSteps===2);
   const next=await work.observe('follow-up');report.observations.push({view:name,name:'follow-up',reference:next});save();
   if(name==='desktop'){
    const contact=await page.evaluate(()=>window.__stoneShards.contacts()[0]);
    await page.mouse.move(contact.screen.x,contact.screen.y);await page.mouse.down();
    await page.waitForFunction(()=>window.__stoneShards.experimentStatus().gripping==='active');
    await page.mouse.move(contact.screen.x+160,contact.screen.y-120,{steps:3});await call('step',8);await page.mouse.up();
    const injured=await work.observe('recorded-grip');report.observations.push({view:name,name:'recorded-grip',reference:injured});save();
    const inputs=await page.evaluate(()=>window.__stoneExperiment.recording());
    check('ordinary native grip and movement retained',inputs.operations.some(v=>v.kind==='stone.input.pick')&&inputs.operations.some(v=>v.kind==='stone.input.move')&&inputs.operations.some(v=>v.kind==='stone.input.release'));
   }
   const recording=await page.evaluate(()=>window.__stoneExperiment.recording());check(`${name} real UI recorded`,recording.complete&&recording.operations.some(v=>v.kind==='stone.tension'&&v.effective.threshold===220));
   const pixels=await page.evaluate(()=>window.__stoneShards.pixels());check(`${name} actual canvas nonblank`,pixels.fraction>0,pixels);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);check(`${name} no horizontal overflow`,!overflow);
  }});
  fs.writeFileSync(path.join(out,`${name}-pointer-input.json`),JSON.stringify(await page.evaluate(()=>window.__ownerPointerInput)));
  await page.close();page=null;
 }
 check('no page errors',report.errors.length===0,report.errors);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};if(page){try{fs.writeFileSync(path.join(out,'failure-pointer-input.json'),JSON.stringify(await page.evaluate(()=>window.__ownerPointerInput)));await page.screenshot({path:path.join(out,'failure.png')});}catch(retention){report.retentionError=retention.message;}}process.exitCode=1;}
finally{if(browser){await browser.close();report.browser.ownedChildExited=true;}save();console.log(JSON.stringify({status:report.status,out,failure:report.failure}));}
