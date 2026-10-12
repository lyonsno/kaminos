import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createShardObservationWork} from './structural-material-shard-observation-retention.mjs';
import {createStoneObservationRuntime} from './structural-material-observation-runtime.mjs';
import {inspectBoundedWitness} from './structural-material-bounded-evidence.mjs';
import {materialComponents} from './structural-material-solid-surface.mjs';
const [out,executable,modulePath,sharedRoot,sharedRevision,url]=process.argv.slice(2);
if(!out)throw new Error('Explicit output required');fs.mkdirSync(path.dirname(out),{recursive:true});
const report={status:'running',phase:'setup',checks:[],inputs:[],errors:[],observations:[],claim:'Ordinary native mouse/input and resident-state composition, not isolated performance or material-quality closure'},save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');save();let browser,page;
const check=(name,pass,data)=>{report.checks.push({name,pass,data});save();assert.ok(pass,name);};
try{
 const effective=fs.realpathSync(executable);if(effective.includes('/Google Chrome.app/'))throw new Error('Independent browser required');report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.shared={root:sharedRoot,requestedRevision:sharedRevision,effectiveRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:sharedRoot,encoding:'utf8'}).trim()};check('exact shared kit',report.shared.effectiveRevision===sharedRevision);
 const {chromium}=await import(pathToFileURL(modulePath)),{experiment}=await import(pathToFileURL(path.join(sharedRoot,'experiment-work.mjs'))),{observationSession,observationResources}=await import(pathToFileURL(path.join(sharedRoot,'observation-session.mjs')));
 report.sources=Object.fromEntries(['structural-material-shard.html','structural-material-shard-view.js','structural-material-solid-resident.js','structural-material-bounded-grip.js','structural-material-bounded-gpu.js','structural-material-observation-economics.mjs'].map(name=>[name,hash(fs.readFileSync(name))]));
 browser=await chromium.launch({executablePath:effective,headless:true,args:['--enable-automation','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});report.browser={executable:effective,version:browser.version()};
 async function open(viewport,name){
  page=await browser.newPage({viewport});page.on('pageerror',e=>{report.errors.push({message:e.message,stack:e.stack,view:name});save();});const loaded=[];
  page.on('response',r=>{const key=Object.keys(report.sources).find(k=>(k.endsWith('.html')?url:new URL(k,url).href)===r.url());if(key)loaded.push((async()=>{const bytes=await r.body();return{key,status:r.status(),sha256:hash(bytes)};})());});
  await page.addInitScript(()=>{
   window.__retainedPointerInput=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])window.addEventListener(type,e=>{if(!e.stoneOrbitReplay)window.__retainedPointerInput.push({type,clientX:e.clientX,clientY:e.clientY,pointerId:e.pointerId,button:e.button,buttons:e.buttons,at:performance.now(),trusted:e.isTrusted});},{capture:true});
   let api;Object.defineProperty(window,'__stoneShards',{configurable:true,get:()=>api,set:value=>{api=value;value.pause(true);}});
  });
  await page.goto(url,{waitUntil:'networkidle',timeout:0});await page.waitForFunction(()=>window.__stoneShards||document.getElementById('failure').textContent,{timeout:0});check(`${name}: exact mounted route`,page.url()===url&&await page.evaluate(()=>Boolean(window.__stoneShards)),await page.locator('#failure').textContent());
  const fetched=await Promise.all(loaded);check(`${name}: source hashes`,Object.keys(report.sources).every(key=>fetched.some(r=>r.key===key&&r.status===200&&r.sha256===report.sources[key])),fetched);
  const call=async expression=>{report.inputs.push({view:name,expression,at:new Date().toISOString()});save();return page.evaluate(expression);},resourceDirectory=path.join(path.dirname(out),name,'resources'),runtime=createStoneObservationRuntime({call,resources:await observationResources({out:resourceDirectory}),resourceDirectory});
  const work=createShardObservationWork({out:path.join(path.dirname(out),name,'observations'),source:{revision:report.sourceRevision,sources:report.sources,shared:report.shared,browser:report.browser,url,viewport,initialPause:'declared mount pause'},experiment,observationSession,runtime,capture:()=>page.screenshot(),record:r=>{const key=name+':'+r.name,index=report.observations.findIndex(x=>x.key===key);if(index<0)report.observations.push({...r,key});else report.observations[index]={...r,key};save();}});
  const observe=async id=>{const result=await work.observe(id),w=runtime.reconstruct(result.observed);check(`${name}:${id}: native bounded integrity`,inspectBoundedWitness(w).length===0,inspectBoundedWitness(w));check(`${name}:${id}: resident components`,JSON.stringify(w.residentInteraction.components)===JSON.stringify(materialComponents(w.state.model.points,w.state.bonds)));return{runId:w.runId,steps:w.state.steps,camera:w.camera,broken:w.state.bonds.reduce((n,v,i)=>n+Number(i%4===2&&v===0),0),events:w.events.map(e=>({id:e.id,steps:e.steps,released:e.released.length})),lastPick:w.lastPick};};
  return {call,observe,runtime};
 }
 let work=await open({width:1280,height:820},'desktop');const initial=await work.observe('initial');report.phase='mouse';save();
 async function stroke(label,dx,dy){
  const contact=(await work.call('window.__stoneShards.contacts()'))[0];report.inputs.push({view:'desktop',mouse:{from:contact.screen,delta:[dx,dy],label,route:'ordinary mouse down/move/up'}});save();
  await work.call('window.__stoneShards.pause(false)');await page.mouse.move(contact.screen.x,contact.screen.y);await page.mouse.down();await page.mouse.move(contact.screen.x+dx,contact.screen.y+dy,{steps:8});await page.mouse.up();await work.call('window.__stoneShards.pause(true)');await work.call('window.__stoneShards.settle({surface:false})');return work.observe(label);
 }
 const first=await stroke('first-drag',25,-20);check('first mouse grip uses resident picking',first.lastPick?.patchOwner==='kaminos.bounded-grip.resident-connectivity.v1',first.lastPick);check('first injury persists',first.broken>initial.broken);check('mouse grip keeps camera',JSON.stringify(first.camera)===JSON.stringify(initial.camera));
 const second=await stroke('second-drag',-20,20);check('second mouse grip same material',second.runId===initial.runId);check('second input retains damage',second.broken>=first.broken);check('fracture history retained',second.events.length>0&&second.events.every(e=>e.steps<=second.steps&&e.released>0),second.events);
 const beforeCamera=await work.call('window.__stoneShards.camera()');await page.mouse.move(30,180);await page.mouse.down();await page.mouse.move(100,200,{steps:6});await page.mouse.up();await work.call('window.__stoneShards.settle({surface:false})');const afterCamera=await work.call('window.__stoneShards.camera()');check('background drag controls camera',JSON.stringify(beforeCamera)!==JSON.stringify(afterCamera));
 report.pointerInput=await page.evaluate(()=>window.__retainedPointerInput);check('ordinary pointer trajectory retained',report.pointerInput.filter(e=>e.type==='pointerdown').length>=3&&report.pointerInput.filter(e=>e.type==='pointerup').length>=3);save();await page.close();
 work=await open({width:390,height:844},'mobile');await work.observe('initial');check('mobile overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('no browser errors',report.errors.length===0,report.errors);report.status='passed';report.phase='complete';save();
}catch(e){report.status='failed';report.failure={message:e.message,stack:e.stack};if(page)try{await page.screenshot({path:path.join(path.dirname(out),'failure.png')});}catch(error){report.retentionError=error.message;}save();process.exitCode=1;}finally{if(browser){await browser.close();report.browser.ownedChildExited=true;}save();console.log(JSON.stringify({status:report.status,phase:report.phase,out,failure:report.failure?.message}));}
