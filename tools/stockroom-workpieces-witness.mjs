import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [origin,expectedRoot,out]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={ok:false,phase:'runtime',origin,expectedRoot,suppressInput:process.env.WORKPIECES_SUPPRESS_INPUT==='1',events:[],errors:[]};
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
 report.phase='load';await save();await page.goto(origin+'/?workspace=workbench&experiment=stockroom-workpieces',{waitUntil:'domcontentloaded'});
 await Promise.race([page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='stockroom-workpieces'),new Promise((_,reject)=>page.once('pageerror',reject))]);
 const settle=()=>page.evaluate(async()=>{await window.kaminosSceneLightingPreparation?.whenIdle();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await settle();await page.evaluate(()=>{window.workpieceRawInput=[];for(const type of ['pointerdown','pointermove','pointerup','keydown','contextmenu'])window.addEventListener(type,e=>window.workpieceRawInput.push({type,x:e.clientX,y:e.clientY,button:e.button,buttons:e.buttons,key:e.key,target:{tag:e.target.tagName,id:e.target.id,choice:e.target.dataset?.workpieceChoice}}),true);});
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const invoke=(op,args)=>page.evaluate(([op,args])=>window.kaminosWorkbenchExperiments.invoke(op,args),[op,args]);
 const shot=async name=>{await settle();await page.screenshot({path:out+'/'+name+'.png'});};
 const at=async piece=>{const s=await read(),p=await page.locator('#kaminos-host-renderer-canvas').evaluate(el=>{const r=el.parentElement.getBoundingClientRect();return {x:r.x,y:r.y};});return {x:p.x+s.screen[piece].target.x,y:p.y+s.screen[piece].target.y};};
 report.initial=await read();report.renderer=await page.evaluate(()=>window.kaminosWorkbenchSceneState());report.gi=await page.evaluate(()=>window.kaminosSceneGIDebugState());
 assert.equal(report.renderer.rendererBackend,'webgpu');assert.equal(report.gi.resolutionScale,.2);await shot('initial');
 if(report.suppressInput)await page.evaluate(()=>document.addEventListener('pointerdown',e=>{e.preventDefault();e.stopImmediatePropagation();},true));
 report.cases=[];
 for(const [piece,choices]of [['stairs',['swing','rebuild']],['trough',['branch','carry','route']],['corner',['carry','leave','wrap']]]){
  report.phase=piece;await save();await invoke('reset');await invoke('frame',{piece});await settle();
  const target=await at(piece);await page.mouse.move(target.x,target.y);await page.keyboard.press('Tab');assert.equal((await read()).stage,'idle');await page.mouse.click(target.x,target.y);
  assert.equal((await read()).stage,'shaping','Native click takes up '+piece);assert.equal((await read()).piece,piece);
  const start=await read();await page.mouse.move(target.x+20,target.y-10);await page.mouse.move(target.x+65,target.y-55);
  const shaped=await read();assert.notDeepEqual(shaped.display[piece],start.display[piece],'Unheld pointer changes '+piece);
  await page.mouse.click(target.x+65,target.y-55);const held=await read();assert.equal(held.stage,'choosing');assert.deepEqual(held.display[piece],shaped.display[piece]);
  const entry={piece,start,shaped,held,previews:[]};report.cases.push(entry);
  await shot(piece+'-choices');
  for(const choice of choices){await page.locator(`[data-workpiece-choice="${choice}"]`).hover();const state=await read();assert.equal(state.highlighted,choice);assert.deepEqual(state.models,held.models,'Preview does not commit');entry.previews.push({choice,state});await shot(piece+'-'+choice);}
  assert.notDeepEqual(entry.previews[0].state.plans[piece],entry.previews[1].state.plans[piece],'Different choices change actual geometry');
  const selected=choices.at(-1);await page.locator(`[data-workpiece-choice="${selected}"]`).click();const chosen=await read();assert.equal(chosen.stage,'tuning');
  const click=await page.evaluate(()=>window.workpieceRawInput.filter(e=>e.type==='pointerup'&&e.button===0).at(-1));
  await page.mouse.move(click.x+24,click.y);const horizontal=await read();assert.notEqual(horizontal.parameters.u,chosen.parameters.u);assert.equal(horizontal.parameters.v,chosen.parameters.v);
  await page.mouse.move(click.x+24,click.y+24);const tuned=await read();assert.equal(tuned.parameters.u,horizontal.parameters.u);assert.notEqual(tuned.parameters.v,horizontal.parameters.v);await shot(piece+'-tuned');
  await page.mouse.click(click.x+24,click.y+24);entry.entered=await read();assert.equal(entry.entered.stage,'idle');assert.deepEqual(entry.entered.models[piece],tuned.parameters);
  const canvas=await page.locator('#kaminos-host-renderer-canvas').boundingBox(),back={x:canvas.x+canvas.width*.85,y:canvas.y+canvas.height*.65};
  await page.mouse.click(back.x,back.y,{button:'right'});assert.equal((await read()).stage,'tuning');assert.deepEqual((await read()).parameters,tuned.parameters);
  await page.mouse.click(back.x,back.y,{button:'right'});assert.equal((await read()).stage,'choosing');
  await page.mouse.click(back.x,back.y,{button:'right'});assert.equal((await read()).stage,'shaping');
  await page.mouse.click(back.x,back.y,{button:'right'});assert.equal((await read()).stage,'idle');assert.deepEqual((await read()).models,report.initial.models);
 }
 report.phase='navigation';await save();await invoke('frame',{piece:'stairs'});await settle();const target=await at('stairs');await page.mouse.click(target.x,target.y);
 const canvas=await page.locator('#kaminos-host-renderer-canvas').boundingBox(),nav={x:canvas.x+canvas.width*.8,y:canvas.y+canvas.height*.7};
 for(const button of ['right','middle']){await page.mouse.move(nav.x,nav.y);const before=await read();await page.mouse.down({button});await page.mouse.move(nav.x+50,nav.y+25);await page.mouse.up({button});await settle();const after=await read();assert.notDeepEqual(after.view.position,before.view.position);assert.deepEqual(after.display,before.display);assert.equal(after.depth,before.depth);await page.mouse.move(nav.x+51,nav.y+26);assert.deepEqual((await read()).display,after.display,'No jump on camera return');}
 await page.keyboard.press('Escape');assert.equal((await read()).stage,'idle');
 async function pixels(){const png=await page.locator('#kaminos-host-renderer-canvas').screenshot();return page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;let low=255,high=0;for(let i=0;i<data.length;i+=4){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}image.close();return {low,high,width:canvas.width,height:canvas.height};},png.toString('base64'));}
 report.desktopPixels=await pixels();assert.ok(report.desktopPixels.high-report.desktopPixels.low>40);
 report.phase='mobile';await save();await page.setViewportSize({width:430,height:860});await invoke('reset');await invoke('frame',{piece:'corner'});await invoke('begin',{piece:'corner'});await invoke('shape',{u:.5,v:0});await invoke('hold');await shot('mobile');
 report.mobilePixels=await pixels();assert.ok(report.mobilePixels.high-report.mobilePixels.low>40);report.mobileLayout=await page.locator('[data-workpiece-choices]').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right};});assert.ok(report.mobileLayout.left>=report.mobileLayout.parentLeft&&report.mobileLayout.right<=report.mobileLayout.parentRight);
 report.rawInput=await page.evaluate(()=>window.workpieceRawInput);report.phase='lifetime';await save();await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.equal(await page.locator('[data-workpiece-overlay]').count(),0);
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.open('stockroom-workpieces'));assert.equal((await read()).stage,'idle');assert.deepEqual((await read()).models,report.initial.models);await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
 assert.equal(report.errors.length,0);report.ok=true;report.phase='complete';
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{try{if(page&&!page.isClosed())report.rawInput=await page.evaluate(()=>window.workpieceRawInput??[]);}catch(error){report.inputRetentionError=String(error);}try{if(browser){await browser.close();report.browserClosed=true;}}catch(error){report.closeError=String(error);report.ok=false;process.exitCode=1;}await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,report:out+'/report.json'}));}
