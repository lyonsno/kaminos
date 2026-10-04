import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [origin,out,expectedRoot]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const report={status:'running',phase:'launch',origin,expectedRoot,executable,errors:[]};
let browser;
try {
  report.runtime=await(await fetch(new URL('/api/runtime-config',origin))).json();
  assert.equal(report.runtime.source.repoRoot,expectedRoot);
  const {chromium}=await import('/private/tmp/beaming-smoke-deps-1001/node_modules/playwright/index.mjs');
  browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  const page=await browser.newPage({viewport:{width:800,height:600}});page.setDefaultTimeout(0);
  await page.addInitScript(()=>{for(const type of ['error','unhandledrejection'])window.addEventListener(type,()=>{window.assayFailed=true;});});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))report.errors.push(m.text());});
  await page.goto(new URL('/tests/scene-gi-native.html',origin).href);
  await page.waitForFunction(()=>window.assayLoaded||window.assayFailed,null,{timeout:0});
  assert.equal(await page.evaluate(()=>window.assayLoaded),true,'native assay initialization failed');
  report.adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,architecture:a.info.architecture};});
  assert.equal(report.adapter.vendor,'apple');
  report.phase='material';
  report.material=await page.evaluate(()=>window.giAssay.material());
  await fs.writeFile(out+'/material.json',JSON.stringify(report.material,null,2));
  assert.ok(report.material[0].sum>0,'dielectric must receive bounce');
  assert.ok(Math.abs(report.material[1].sum/report.material[0].sum-.5)<.01,'half metal must receive half diffuse bounce');
  assert.equal(report.material[2].sum,0,'full metal must not receive diffuse bounce');
  assert.deepEqual(report.material.map(x=>x.raw),Array(3).fill(report.material[0].raw),'incoming field must stay fixed');
  report.sourceResponse=await page.evaluate(()=>window.giAssay.sourceResponse());
  assert.ok(Math.abs(report.sourceResponse[1].raw.sum/report.sourceResponse[0].raw.sum-.25)<.01);
  assert.equal(report.sourceResponse[2].raw.sum,0,'extinguished source must leave no stale GI');
  report.phase='views';
  for(const [name,gain,position] of [['bounce-on',1,[4,3,5]],['bounce-off',0,[4,3,5]],['oblique',1,[1,4,6]]]) {
    await page.evaluate(([g,p])=>window.giAssay.view(g,p),[gain,position]);
    await page.screenshot({path:out+'/'+name+'.png'});
  }
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(500);
  await page.screenshot({path:out+'/mobile.png'});
  assert.deepEqual(report.errors,[]);
  report.status='passed';report.phase='complete';
} catch(error) {report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally {await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();}
