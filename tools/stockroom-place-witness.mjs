import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const [origin,expectedRoot,out]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={ok:false,phase:'runtime',origin,expectedRoot,errors:[],suppressInput:process.env.PLACE_SUPPRESS_INPUT==='1'};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
await save();let browser,page;
try{
 report.runtime=await(await fetch(origin+'/api/runtime-config')).json();assert.equal(report.runtime.source.repoRoot,expectedRoot);
 const bytes=await fs.readFile(new URL(import.meta.url));report.witnessSha256=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(out+'/witness.mjs',bytes);
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/Users/noahlyons/.local/state/kaminos/minion-visual-handoff-1004/browser-deps/node_modules/playwright-core/index.mjs');
 report.executable=await fs.realpath(process.env.CHROMIUM_EXECUTABLE??'/Users/noahlyons/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
 assert.ok(!report.executable.includes('/Applications/Google Chrome.app/'),'Independent browser required');
 report.phase='browser';await save();browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1640,height:1050},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
 page=await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);page.on('pageerror',e=>report.errors.push(e.stack));
 report.phase='load';await save();await page.goto(origin+'/?workspace=workbench&experiment=stockroom-place',{waitUntil:'domcontentloaded'});
 await Promise.race([page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='stockroom-place'),new Promise((_,reject)=>page.once('pageerror',reject))]);
 const settle=()=>page.evaluate(async()=>{await window.kaminosSceneLightingPreparation?.whenIdle();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await settle();await page.evaluate(()=>{window.placeRawInput=[];for(const type of ['pointerdown','pointermove','pointerup','keydown','contextmenu'])window.addEventListener(type,e=>window.placeRawInput.push({type,x:e.clientX,y:e.clientY,button:e.button,buttons:e.buttons,key:e.key,target:{tag:e.target.tagName,id:e.target.id,action:e.target.dataset?.placeAction}}),true);});
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const invoke=(op,args)=>page.evaluate(([op,args])=>window.kaminosWorkbenchExperiments.invoke(op,args),[op,args]);
 const shot=async name=>{await settle();await page.screenshot({path:out+'/'+name+'.png'});};
 report.initial=await read();report.renderer=await page.evaluate(()=>window.kaminosWorkbenchSceneState());report.gi=await page.evaluate(()=>window.kaminosSceneGIDebugState());
 assert.equal(report.renderer.rendererBackend,'webgpu');assert.equal(report.gi.resolutionScale,.2);await shot('initial');
 report.phase='resolved';await invoke('realize',{value:'deck'});report.resolved=await read();assert.equal(report.resolved.place.mode,'establish');assert.deepEqual(report.resolved.place.regions,report.initial.place.regions);await shot('resolved');
 assert.equal(report.errors.length,0);report.ok=true;report.phase='complete';
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 try{if(page&&!page.isClosed())report.rawInput=await page.evaluate(()=>window.placeRawInput??[]);}catch(error){report.inputRetentionError=String(error);}
 try{if(browser){await browser.close();report.browserClosed=true;}}catch(error){report.closeError=String(error);report.ok=false;process.exitCode=1;}
 await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,report:out+'/report.json'}));
}
