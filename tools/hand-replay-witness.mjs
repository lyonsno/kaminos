import {pathToFileURL} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const [url,out,browser,playwright]=process.argv.slice(2);assert(url&&out&&browser&&playwright);mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'launch',url,browser,errors:[],states:[]};let context,page;
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();
try{
 const {chromium}=await import(pathToFileURL(playwright));
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:browser,headless:true,args:['--use-mock-keychain','--password-store=basic'],viewport:{width:1600,height:1100},deviceScaleFactor:1});
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 report.phase='page';save();await page.goto(url);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='hand-replay');
 await page.waitForFunction(()=>!!document.querySelector('[data-recorded-frame]'));
 const invoke=(op,arg)=>page.evaluate(([op,arg])=>window.kaminosWorkbenchExperiments.invoke(op,arg),[op,arg]);
 report.phase='exercise';save();
 const fallback=await invoke('seek',0);assert.equal(fallback.displayed[0].fallback,true);
 await page.getByRole('status').filter({hasText:'manual fallback crop'}).waitFor();
 await page.screenshot({path:out+'/fallback-frame.png'});
 for(const frame of [70,73,90]){
  const state=await invoke('seek',frame);assert.equal(state.frame,frame);assert.equal(state.models.length,4);assert.equal(state.inference,'precomputed');assert.equal(state.fluid,false);report.states.push(state);
  await page.screenshot({path:`${out}/frame-${frame}.png`});
 }
 await page.getByLabel('Launch finger').selectOption('2');assert.equal((await page.evaluate(()=>window.kaminosWorkbenchExperiments.read())).finger,2);
 await page.getByLabel('Launch finger').selectOption('4');
 await invoke('setOrigin','tip');assert.equal((await page.evaluate(()=>window.kaminosWorkbenchExperiments.read())).commonOrigin,false);await page.screenshot({path:out+'/tip-origin.png'});
 await invoke('setOrigin','shared');await invoke('seek',65);await page.getByRole('button',{name:'Play',exact:true}).click();
 const waited=await page.waitForFunction(()=>Number(document.querySelector('[data-recorded-frame]')?.dataset.recordedFrame)>=75);report.waitValue=await waited.jsonValue();report.prePause=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());await invoke('pause');const played=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());report.played=played;assert(played.frame>=75);report.states.push(played);
 await invoke('load',1);await invoke('seek',200);report.states.push(await page.evaluate(()=>window.kaminosWorkbenchExperiments.read()));await page.screenshot({path:out+'/long-frame-200.png'});
 await invoke('load',0);await invoke('seek',70);await page.screenshot({path:out+'/offer.png'});
 assert.deepEqual(report.errors,[]);report.status='exercised';report.phase=null;
}catch(e){report.error=String(e);if(page){report.failedState=await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state()).catch(String);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}process.exitCode=1;}
finally{await context?.close();report.browserClosed=true;save();}
