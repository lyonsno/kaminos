import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [url,out,browser,playwright]=process.argv.slice(2);if(!url||!out||!browser||!playwright)throw Error('usage: URL OUTPUT BROWSER PLAYWRIGHT');
mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'launch',url,browser,errors:[],states:[]};let context,page;
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');save();
try{
 const {chromium}=await import(pathToFileURL(playwright));
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:browser,headless:true,args:['--use-mock-keychain','--password-store=basic'],viewport:{width:1680,height:1080},deviceScaleFactor:1});
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 report.phase='load';save();await page.goto(url);await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='hand-replay');
 const state=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 await page.waitForFunction(()=>document.querySelector('[data-recorded-frame]'));
 const first=await state();report.states.push(first);assert.equal(first.moment,'shape');assert.equal(first.frame,70);assert.equal(first.scaleMode,'predicted');assert.deepEqual(first.visibleModels,['original','trained']);
 report.phase='size-comparison';save();await page.screenshot({path:out+'/shape-predicted.png'});
 await page.getByLabel('Hand display size',{exact:true}).selectOption('palm');const scaled=await state();report.states.push(scaled);assert(scaled.displayScales[1]>1.2);assert.deepEqual(scaled.trace,first.trace);await page.screenshot({path:out+'/shape-same-palm.png'});
 await page.getByLabel('Hand display size',{exact:true}).selectOption('predicted');
 report.phase='loop';save();await page.getByLabel('Comparison moment',{exact:true}).selectOption('middle');await page.waitForFunction(()=>document.querySelector('[data-recorded-frame="241"]')&&!document.querySelector('[data-recorded-frame]').textContent.includes('Loading'));
 const middle=await state();report.states.push(middle);assert.equal(middle.frame,241);assert.equal(middle.trace.finger,2);assert(Math.abs(middle.trace.series[1].rangePercent-81.51888067)<.001);await page.screenshot({path:out+'/middle-paused.png'});
 await page.getByRole('button',{name:'Play loop',exact:true}).click();
 await page.waitForFunction(()=>{const frame=Number(document.querySelector('[data-recorded-frame]').dataset.recordedFrame);const prev=window.__previousGuidedFrame;window.__previousGuidedFrame=frame;return prev!==undefined&&frame<prev;});
 const looped=await state();assert.equal(looped.playing,true);report.states.push(looped);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 const graph=page.getByLabel('Finger deformation trace',{exact:true});const box=await graph.boundingBox();await graph.click({position:{x:box.width*.6,y:box.height*.5}});
 const clicked=await state();assert.equal(clicked.playing,false);assert.equal(clicked.trace.cursorFrame,clicked.frame);assert(clicked.frame>=237&&clicked.frame<=249);report.states.push(clicked);
 await page.getByLabel('Camera view',{exact:true}).selectOption('full');await page.screenshot({path:out+'/middle-full-camera.png'});
 await page.getByText('Teachers, trajectories and recording details',{exact:true}).click();await page.getByLabel('Show teachers',{exact:true}).check();assert.equal((await state()).visibleModels.length,4);await page.screenshot({path:out+'/teachers.png'});
 await page.getByLabel('Show teachers',{exact:true}).uncheck();await page.getByLabel('Camera view',{exact:true}).selectOption('crop');
 await page.getByLabel('Comparison moment',{exact:true}).selectOption('pointing');await page.waitForFunction(()=>document.querySelector('[data-recorded-frame="38"]')&&!document.querySelector('[data-recorded-frame]').textContent.includes('Loading'));assert.equal((await state()).frame,38);
 report.phase='reopen';save();await page.reload();await page.waitForFunction(()=>document.querySelector('[data-recorded-frame="70"]'));assert.equal((await state()).scaleMode,'predicted');
 assert.deepEqual(report.errors,[]);report.status='observed';report.phase=null;
}catch(e){report.error=String(e);if(page){report.lastState=await page.evaluate(()=>window.kaminosWorkbenchExperiments?.read?.()).catch(String);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}process.exitCode=1;}
finally{await context?.close();report.browserClosed=true;save();}
