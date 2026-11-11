import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [origin,expectedRoot,out]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={ok:false,phase:'runtime',receiver:'stockroom-shocktroops',origin,expectedRoot,suppressedInput:process.env.FOLD_FLOW_SUPPRESS_INPUT==='1',events:[],errors:[]},save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
await save();let browser;
try{
 report.runtime=await(await fetch(origin+'/api/runtime-config')).json();assert.equal(report.runtime.source.repoRoot,expectedRoot);
 const witness=await fs.readFile(new URL(import.meta.url));report.witnessSha256=createHash('sha256').update(witness).digest('hex');await fs.writeFile(out+'/witness.mjs',witness);
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/Users/noahlyons/.local/state/kaminos/minion-visual-handoff-1004/browser-deps/node_modules/playwright-core/index.mjs');
 report.executable=process.env.CHROMIUM_EXECUTABLE??'/Users/noahlyons/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 report.phase='browser';await save();browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1640,height:1050},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
 const page=await browser.newPage();page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);page.on('pageerror',e=>{report.errors.push(e.stack);});
 report.phase='load';await save();await page.goto(origin+'/?workspace=workbench&experiment=stockroom-fold-flow',{waitUntil:'domcontentloaded'});
 await Promise.race([page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='stockroom-fold-flow'||window.kaminosWorkbenchSceneFrameError),new Promise((_,reject)=>page.once('pageerror',reject))]);
 await page.evaluate(()=>window.kaminosSceneLightingPreparation?.whenIdle());
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const shot=async name=>{await page.screenshot({path:out+'/'+name+'.png'});};
 report.initial=await read();report.renderer=await page.evaluate(()=>window.kaminosWorkbenchSceneState());report.gi=await page.evaluate(()=>window.kaminosSceneGIDebugState());assert.equal(report.renderer.rendererBackend,'webgpu');assert.equal(report.gi.resolutionScale,.2);await shot('initial');
 if(report.suppressedInput)await page.evaluate(()=>document.addEventListener('pointerdown',e=>{e.preventDefault();e.stopImmediatePropagation();},true));
 report.phase='native-fold';await save();
 const rect=await page.locator('#kaminos-host-renderer-canvas').boundingBox(),parent=await page.locator('#kaminos-host-renderer-canvas').evaluate(el=>{const r=el.parentElement.getBoundingClientRect();return {x:r.x,y:r.y};});
 const mouse=async(name,x,y)=>{report.events.push({name,x,y});await page.mouse.move(x,y);};
 const leaf=report.initial.screen.leaf;await mouse('leaf',parent.x+leaf.x,parent.y+leaf.y);await page.mouse.down();await page.mouse.up();
 report.creased=await read();assert.equal(report.creased.creased,true,'native click creates the prepared crease');
 const p=report.creased.screen.leaf;await mouse('fold-start',parent.x+p.x,parent.y+p.y);await page.mouse.down();
 // Project a continuous angular path through the real native camera.
 for(const angle of [.25,.5,.8,1.1,1.4,1.7,2,2.3,2.5,2.1,2.5]){
  const point=await page.evaluate(async angle=>{const T=await import('/lib/three.core.js'),state=await window.kaminosWorkbenchExperiments.read(),r=document.querySelector('#kaminos-host-renderer-canvas').getBoundingClientRect(),v=state.view,camera=new T.PerspectiveCamera(v.fov,r.width/r.height,v.near,v.far);camera.position.fromArray(v.position);camera.up.fromArray(v.up);camera.zoom=v.zoom;camera.lookAt(new T.Vector3(...v.target));camera.updateProjectionMatrix();camera.updateMatrixWorld(true);const p=new T.Vector3(-1.3+2.45*Math.cos(angle),1.05+2.45*Math.sin(angle),0).applyMatrix4(new T.Matrix4().fromArray(state.rootMatrix)).project(camera);return {x:(p.x+1)*r.width/2,y:(1-p.y)*r.height/2};},angle);
  await mouse('fold:'+angle,parent.x+point.x,parent.y+point.y);const sample=await read();report.events.push({name:'effective',angle:sample.angle,encounter:sample.encounter});if(angle===2.1)assert.equal(sample.encounter,null,'retreat withdraws the opportunity');
 }
 await page.mouse.up();report.folded=await read();assert.ok(report.folded.angle>2,'pointer drag actually folds');assert.ok(report.folded.encounter,'fold exposes receiving opportunity');await shot('encounter');
 assert.equal(await page.locator('[data-fold-accept]').isVisible(),true);await page.locator('[data-fold-accept]').click();report.accepted=await read();assert.equal(report.accepted.receiver,true);assert.equal(report.accepted.encounter,null);await shot('received');
 report.phase='native-next';await save();const tip=report.accepted.screen.tip;await mouse('tip',parent.x+tip.x,parent.y+tip.y);await page.mouse.down();await page.mouse.up();report.next=await read();assert.equal(report.next.secondCrease,true,'new receiver offers another crease');
 await page.mouse.down();assert.equal((await read()).gesture,'tip');for(const offset of [12,25,45])await mouse('tip-bend',parent.x+tip.x+offset,parent.y+tip.y-offset/2);await page.mouse.up();report.nextBent=await read();assert.ok(Math.abs(report.nextBent.secondAngle)>.02,'the next articulation actually moves');await shot('next');
 const beforeCancel=await read(),lp=beforeCancel.screen.leafBase;await mouse('cancel-start',parent.x+lp.x,parent.y+lp.y);await page.mouse.down();assert.equal((await read()).gesture,'leaf');await mouse('cancel-move',parent.x+lp.x+35,parent.y+lp.y-30);assert.ok(Math.abs((await read()).angle-beforeCancel.angle)>.02);await page.keyboard.press('Escape');await page.mouse.up();report.cancelled=await read();assert.equal(report.cancelled.angle,beforeCancel.angle,'Escape restores the prior fold');
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('reset'));report.reset=await read();assert.equal(report.reset.receiver,false);assert.equal(report.reset.creased,false);
 async function pixels(){const png=await page.locator('#kaminos-host-renderer-canvas').screenshot();return page.evaluate(async bytes=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,image.width,image.height).data;let low=255,high=0;for(let i=0;i<data.length;i+=4){low=Math.min(low,data[i]);high=Math.max(high,data[i]);}image.close();return {low,high,width:canvas.width,height:canvas.height};},png.toString('base64'));}
 report.desktopPixels=await pixels();assert.ok(report.desktopPixels.high-report.desktopPixels.low>40);
 await page.setViewportSize({width:430,height:860});await shot('mobile');report.mobile=await read();report.mobilePixels=await pixels();assert.ok(report.mobilePixels.high-report.mobilePixels.low>40);
 report.phase='close';await save();await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
 assert.equal(report.errors.length,0);assert.ok(rect.width>0);report.ok=true;report.phase='complete';
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{try{if(browser){await browser.close();report.browserClosed=true;}}catch(error){report.closeError=String(error);report.ok=false;process.exitCode=1;}await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error,report:out+'/report.json'}));}
