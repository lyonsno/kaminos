import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [origin,expectedRoot,out]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={ok:false,phase:'runtime',receiver:'stockroom-shocktroops',origin,expectedRoot,suppressedInput:process.env.FOLD_FLOW_SUPPRESS_INPUT==='1',events:[],errors:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
await save();let browser,page;
try{
 report.runtime=await(await fetch(origin+'/api/runtime-config')).json();assert.equal(report.runtime.source.repoRoot,expectedRoot);
 const witness=await fs.readFile(new URL(import.meta.url));report.witnessSha256=createHash('sha256').update(witness).digest('hex');await fs.writeFile(out+'/witness.mjs',witness);
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/Users/noahlyons/.local/state/kaminos/minion-visual-handoff-1004/browser-deps/node_modules/playwright-core/index.mjs');
 report.executable=process.env.CHROMIUM_EXECUTABLE??'/Users/noahlyons/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 report.phase='browser';await save();browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1640,height:1050},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
 page=await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);page.on('pageerror',e=>report.errors.push(e.stack));
 report.phase='load';await save();await page.goto(origin+'/?workspace=workbench&experiment=stockroom-fold-flow',{waitUntil:'domcontentloaded'});
 await Promise.race([page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='stockroom-fold-flow'||window.kaminosWorkbenchSceneFrameError),new Promise((_,reject)=>page.once('pageerror',reject))]);
 await page.evaluate(()=>window.kaminosSceneLightingPreparation?.whenIdle());
 await page.evaluate(()=>{window.foldRawInput=[];for(const type of ['pointerdown','pointermove','pointerup','keydown','contextmenu'])window.addEventListener(type,e=>window.foldRawInput.push({type,x:e.clientX,y:e.clientY,button:e.button,buttons:e.buttons,key:e.key,target:{tag:e.target.tagName,id:e.target.id,classes:e.target.className}}),true);});
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const shot=name=>page.screenshot({path:out+'/'+name+'.png'});
 const pointer=async(name,x,y)=>{report.events.push({name,x,y});await page.mouse.move(x,y);};
 const at=async name=>{const s=await read(),p=await page.locator('#kaminos-host-renderer-canvas').evaluate(el=>{const r=el.parentElement.getBoundingClientRect();return {x:r.x,y:r.y};});return {x:p.x+s.screen[name].x,y:p.y+s.screen[name].y};};
 report.initial=await read();report.renderer=await page.evaluate(()=>window.kaminosWorkbenchSceneState());report.gi=await page.evaluate(()=>window.kaminosSceneGIDebugState());
 assert.equal(report.renderer.rendererBackend,'webgpu');assert.equal(report.gi.resolutionScale,.2);await shot('initial');
 if(report.suppressedInput)await page.evaluate(()=>document.addEventListener('pointerdown',e=>{e.preventDefault();e.stopImmediatePropagation();},true));
 report.phase='native-click-fold';await save();
 const leaf=await at('leaf');await pointer('leaf',leaf.x,leaf.y);await page.keyboard.press('Tab');
 report.afterTab=await read();assert.equal(report.afterTab.stage,'idle');
 report.tabStatus=await page.locator('#info-bar').innerText();assert.doesNotMatch(report.tabStatus,/Select a mesh object|No mesh|failed/i);
 await page.mouse.click(leaf.x,leaf.y);assert.equal((await read()).stage,'bending','native click takes up the fold without holding');
 for(const angle of [.25,.5,.8,1.1,1.4,1.7,2,2.3,2.5]){
  const p=await page.evaluate(async angle=>{
   const T=await import('/lib/three.core.js'),s=await window.kaminosWorkbenchExperiments.read(),r=document.querySelector('#kaminos-host-renderer-canvas').getBoundingClientRect(),v=s.view;
   const camera=new T.PerspectiveCamera(v.fov,r.width/r.height,v.near,v.far);camera.position.fromArray(v.position);camera.up.fromArray(v.up);camera.zoom=v.zoom;camera.lookAt(new T.Vector3(...v.target));camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
   const p=new T.Vector3(-1.3+2.45*Math.cos(angle),1.05+2.45*Math.sin(angle),0).applyMatrix4(new T.Matrix4().fromArray(s.rootMatrix)).project(camera);
   return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2};
  },angle);
  await pointer('fold:'+angle,p.x,p.y);report.events.push({name:'effective',state:await read()});
 }
 report.folded=await read();assert.ok(report.folded.angle>2,'unheld pointer motion actually folds');assert.ok(report.folded.encounter);
 const hold=await at('leaf');await page.mouse.click(hold.x,hold.y);report.held=await read();assert.equal(report.held.stage,'choosing');await shot('choices');
 const canvas=await page.locator('#kaminos-host-renderer-canvas').boundingBox();
 await pointer('browse-away',canvas.x+canvas.width-20,canvas.y+canvas.height*.5);
 assert.equal((await read()).angle,report.held.angle,'moving toward choices cannot destroy the held encounter');
 const side=page.locator('[data-fold-choice="side"]'),drop=page.locator('[data-fold-choice="drop"]');
 await side.hover();report.sidePreview=await read();assert.equal(report.sidePreview.highlighted,'side');assert.equal(report.sidePreview.committed.receiver,false);await shot('side-preview');
 await drop.hover();report.dropPreview=await read();assert.equal(report.dropPreview.receiverKind,'drop');assert.equal(report.dropPreview.committed.receiver,false);await shot('drop-preview');
 report.phase='native-pair-tune';await save();await side.click();report.chosen=await read();assert.equal(report.chosen.stage,'tuning');
 // The choice disappears on selection; retain its original click location from raw input.
 const start=await page.evaluate(()=>window.foldRawInput.filter(e=>e.type==='pointerup'&&e.button===0).at(-1));
 await pointer('span-only',start.x-45,start.y);const spanOnly=await read();
 assert.ok(Math.abs(spanOnly.parameters.extent-report.chosen.parameters.extent)>.1);assert.equal(spanOnly.parameters.angle,report.chosen.parameters.angle);
 await pointer('angle-only',start.x-45,start.y-35);report.tuned=await read();
 assert.equal(report.tuned.parameters.extent,spanOnly.parameters.extent);assert.ok(Math.abs(report.tuned.parameters.angle-spanOnly.parameters.angle)>.2);await shot('tuned');
 await page.mouse.click(start.x-45,start.y-35);report.entered=await read();assert.equal(report.entered.stage,'idle');
 assert.equal(report.entered.committed.receiver,true);assert.equal(report.entered.receiverExtent,report.tuned.parameters.extent);assert.equal(report.entered.receiverAngle,report.tuned.parameters.angle);await shot('entered');
 report.phase='native-back';await save();
 const backPoint={x:canvas.x+canvas.width*.78,y:canvas.y+canvas.height*.45};
 await page.mouse.click(backPoint.x,backPoint.y,{button:'right'});report.backTune=await read();assert.equal(report.backTune.stage,'tuning');assert.deepEqual(report.backTune.parameters,report.tuned.parameters);
 await page.mouse.click(backPoint.x,backPoint.y,{button:'right'});report.backChoices=await read();assert.equal(report.backChoices.stage,'choosing');assert.equal(report.backChoices.angle,report.held.angle);
 await page.mouse.click(backPoint.x,backPoint.y,{button:'right'});assert.equal((await read()).stage,'bending');
 await page.mouse.click(backPoint.x,backPoint.y,{button:'right'});assert.equal((await read()).stage,'idle');assert.equal((await read()).angle,0);
 report.phase='native-navigation';await save();
 await page.mouse.click(leaf.x,leaf.y);assert.equal((await read()).stage,'bending');let cameraAngle;
 for(const button of ['right','middle']){
  await pointer('camera:'+button,backPoint.x,backPoint.y);const before=await read();await page.mouse.down({button});
  await pointer('camera-drag:'+button,backPoint.x+50,backPoint.y+25);await page.mouse.up({button});const after=await read();
  assert.notDeepEqual(after.view.position,before.view.position,button+' drag remains camera navigation');assert.equal(after.depth,before.depth);assert.equal(after.angle,before.angle);cameraAngle=after.angle;
 }
 await pointer('resume-after-camera',backPoint.x+51,backPoint.y+26);report.navigation=await read();
 assert.equal(report.navigation.angle,cameraAngle,'camera return does not jump the authored angle');
 await page.keyboard.press('Escape');assert.equal((await read()).stage,'idle');
 report.phase='next-articulation';await save();
 // API setup uses the same operations; the continuation itself is real pointer input.
 await page.evaluate(async()=>{const e=window.kaminosWorkbenchExperiments;await e.invoke('begin',{part:'leaf'});await e.invoke('bend',{angle:2.5});await e.invoke('hold');await e.invoke('highlight',{choice:'drop'});await e.invoke('choose');await e.invoke('tune',{extent:1.7,angle:1.3});await e.invoke('enter');await e.invoke('frame');});
 const tip=await at('tip');await page.mouse.click(tip.x,tip.y);report.next=await read();assert.equal(report.next.stage,'bending');assert.equal(report.next.part,'tip');
 await pointer('next-bend',tip.x+38,tip.y-24);report.nextBent=await read();assert.ok(Math.abs(report.nextBent.secondAngle-report.next.secondAngle)>.02);await page.mouse.click(tip.x+38,tip.y-24);await shot('next');
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('reset'));assert.equal((await read()).depth,0);
 async function pixels(){const png=await page.locator('#kaminos-host-renderer-canvas').screenshot();return page.evaluate(async bytes=>{
  const image=await createImageBitmap(new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const data=ctx.getImageData(0,0,image.width,image.height).data;let low=255,high=0;for(let i=0;i<data.length;i+=4){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}image.close();return {low,high,width:canvas.width,height:canvas.height};
 },png.toString('base64'));}
 report.desktopPixels=await pixels();assert.ok(report.desktopPixels.high-report.desktopPixels.low>40);
 await page.setViewportSize({width:430,height:860});
 await page.evaluate(async()=>{const e=window.kaminosWorkbenchExperiments;await e.invoke('begin');await e.invoke('bend',{angle:2.5});await e.invoke('hold');});
 await shot('mobile');report.mobilePixels=await pixels();assert.ok(report.mobilePixels.high-report.mobilePixels.low>40);
 const layout=await page.locator('[data-fold-choices]').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return {left:a.left,right:a.right,parentLeft:b.left,parentRight:b.right};});assert.ok(layout.left>=layout.parentLeft&&layout.right<=layout.parentRight);
 report.rawInput=await page.evaluate(()=>window.foldRawInput);report.phase='close';await save();await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
 assert.equal(report.errors.length,0);report.ok=true;report.phase='complete';
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 try{if(page&&!page.isClosed())report.rawInput=await page.evaluate(()=>window.foldRawInput??[]);}catch(error){report.inputRetentionError=String(error);}
 try{if(browser){await browser.close();report.browserClosed=true;}}catch(error){report.closeError=String(error);report.ok=false;process.exitCode=1;}
 await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,report:out+'/report.json'}));
}
