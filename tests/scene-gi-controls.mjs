import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {buildSceneDocument} from '../scene-persistence-core.js';
const [origin,out,expectedRoot]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report={status:'running',phase:'load',executable,origin,expectedRoot,errors:[]};
let browser;
try {
  report.runtime=await(await fetch(new URL('/api/runtime-config',origin))).json();
  assert.equal(report.runtime.source.repoRoot,expectedRoot);
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(0);
  page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(origin);
  await page.waitForFunction(()=>window.kaminosSceneGIDebugState,null,{timeout:0});
  assert.equal(await page.locator('#scene-gi-general-slot #scene-gi-mode').count(),1);
  report.phase='restore';
  for(const extra of [{},{futureQuality:'compatible-addition'}]) {
    const data=buildSceneDocument({postprocessing:{sceneGI:{mode:'combined',view:'scene',gain:2,...extra}}});
    await page.setInputFiles('#scene-file-input',{name:'gi-control-test.kaminos.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    await page.waitForFunction(()=>window.kaminosSceneGIDebugState().gain===2,null,{timeout:0});
    assert.equal(await page.inputValue('#scene-gi-mode'),'combined');
    assert.equal(await page.inputValue('#scene-gi-gain'),'2');
    await page.locator('#scene-gi-panel').scrollIntoViewIfNeeded();
    await page.screenshot({path:out+'/'+(extra.futureQuality?'additive':'ordinary')+'.png'});
    await page.$eval('#scene-gi-gain',e=>{e.value='1';e.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  await page.selectOption('#scene-gi-mode','gtao');
  assert.equal((await page.evaluate(()=>window.kaminosSceneGIDebugState())).effectiveMode,'gtao');
  report.status='passed';report.phase='complete';assert.deepEqual(report.errors,[]);
} catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();}
