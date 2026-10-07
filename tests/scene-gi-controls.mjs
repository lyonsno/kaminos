import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {buildSceneDocument} from '../scene-persistence-core.js';
const [origin,out,expectedRoot]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report={status:'running',phase:'load',executable,origin,expectedRoot,errors:[]};
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
await save();
let browser;
try {
  report.runtime=await(await fetch(new URL('/api/runtime-config',origin))).json();
  assert.equal(report.runtime.source.repoRoot,expectedRoot);
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(0);
  let rejectLoad;
  const loadFailure=new Promise((_,reject)=>{rejectLoad=reject;});
  page.on('pageerror',e=>{report.errors.push(String(e));void save();rejectLoad(e);});
  page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void save();}});
  await page.goto(origin);
  await Promise.race([page.waitForFunction(()=>window.kaminosSceneGIDebugState,null,{timeout:0}),loadFailure]);
  assert.equal(await page.locator('#scene-gi-general-slot #scene-gi-mode').count(),1);
  report.phase='restore';await save();
  const observedScene=await(await fetch(new URL('/api/read?root=scenes&path=cheap-kiln-shared-source.kaminos.json',origin))).json();
  assert.ok(observedScene.objects?.length,'registered mesh fixture is missing');
  for(const extra of [{},{futureQuality:'compatible-addition'}]) {
    const data=buildSceneDocument({objects:observedScene.objects,camera:observedScene.camera,postprocessing:{sceneGI:{mode:'combined',view:'scene',gain:2,...extra}}});
    await fs.writeFile(out+'/'+(extra.futureQuality?'additive':'ordinary')+'.kaminos.json',JSON.stringify(data,null,2));
    await page.setInputFiles('#scene-file-input',{name:'gi-control-test.kaminos.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    await page.waitForFunction(()=>window.kaminosSceneGIDebugState().gain===2||/Invalid|failed/i.test(document.getElementById('info-bar').textContent),null,{timeout:0});
    assert.equal(await page.evaluate(()=>window.kaminosSceneGIDebugState().gain),2,await page.locator('#info-bar').textContent());
    assert.equal(await page.inputValue('#scene-gi-mode'),'combined');
    assert.equal(await page.inputValue('#scene-gi-gain'),'2');
    await page.evaluate(()=>window.__kaminosSetSceneCameraFrame([3,2,9],[0,.7,0]));
    await page.locator('.env-btn[data-env="neutral"]').click();
    await page.locator('#rim-enabled').check();
    await page.waitForTimeout(2000);
    await page.locator('#scene-gi-panel').scrollIntoViewIfNeeded();
    await page.screenshot({path:out+'/'+(extra.futureQuality?'additive':'ordinary')+'.png'});
    await page.$eval('#scene-gi-gain',e=>{e.value='1';e.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  await page.selectOption('#scene-gi-mode','gtao');
  await page.evaluate(()=>window.__kaminosSetSceneCameraFrame([3,2,9],[0,.7,0]));
  await page.waitForTimeout(2000);
  await page.screenshot({path:out+'/restored-gtao.png'});
  report.state=await page.evaluate(()=>({gi:window.kaminosSceneGIDebugState(),objects:window.kaminosSceneObjectDebugState(),
    canvases:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,width:c.width,height:c.height,opacity:getComputedStyle(c).opacity,display:getComputedStyle(c).display,position:getComputedStyle(c).position,zIndex:getComputedStyle(c).zIndex})),
    volumeActive:window.__kaminosVolumePrototype?.debugState().active}));
  assert.equal((await page.evaluate(()=>window.kaminosSceneGIDebugState())).effectiveMode,'gtao');
  report.status='passed';report.phase='complete';assert.deepEqual(report.errors,[]);
} catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();}
