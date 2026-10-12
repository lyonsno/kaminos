import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {BURN_TABLE_ASSET} from '../burn-table-core.mjs';
const out=process.argv[2];
if(!out||!process.env.KAMINOS_URL||!process.env.CHROME_EXECUTABLE||!process.env.PLAYWRIGHT_MODULE)throw Error('Supply output path, KAMINOS_URL, CHROME_EXECUTABLE and PLAYWRIGHT_MODULE');
await fs.mkdir(out,{recursive:true});
const report={status:'starting',phase:'launch',url:process.env.KAMINOS_URL,repoRoot:path.resolve(import.meta.dirname,'..'),executable:process.env.CHROME_EXECUTABLE,errors:[]};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
let browser,page;
try {
  await save();
  assert.ok(!report.executable.includes('/Applications/Google Chrome.app/'),'Independent browser required');
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)(report.httpErrors ||= []).push({url:response.url(),status:response.status()});});
  report.phase='load';await page.goto(report.url);
  await page.waitForFunction(()=>['mounted','failed'].includes(window.kaminosBurnTable?.state().status));
  report.effectiveUrl=page.url();report.state=await page.evaluate(()=>window.kaminosBurnTable.state());
  assert.equal(report.state.status,'mounted');assert.equal(report.state.simulation,false);
  assert.equal(report.state.asset.sha256,BURN_TABLE_ASSET.sha256);
  assert.equal(new Set(report.state.objects.map(o=>o.id)).size,4);
  assert.ok(report.state.objects.every(o=>o.id));
  const resource=await page.request.get(new URL(report.state.source,report.url).href);
  report.assetBytes=(await resource.body()).length;assert.equal(report.assetBytes,41969408);
  report.shell=await page.evaluate(()=>({active:document.body.classList.contains('experiment-workspace'),tool:window.kaminosFluidWorkbenchState().tool,
    inspector:document.getElementById('authoring-inspector').checkVisibility(),simulation:window.kaminosFingerFluidBenchSessionState?.()}));
  assert.equal(report.shell.active,true);assert.equal(report.shell.tool,'assets');assert.equal(report.shell.inspector,true);
  assert.notEqual(report.shell.simulation?.running,true);
  await page.locator('#burn-table-animation').uncheck();
  await page.screenshot({path:path.join(out,'table.png')});
  report.phase='controls';
  await page.locator('#burn-table-sample').selectOption('active');
  await page.locator('#burn-table-heat').evaluate(input=>{input.value='0';input.dispatchEvent(new Event('input'));});
  assert.equal((await page.evaluate(()=>window.kaminosBurnTable.state())).states[2].heat,0);
  await page.screenshot({path:path.join(out,'cooled-active.png')});
  await page.locator('#burn-table-reset').click();
  assert.equal((await page.evaluate(()=>window.kaminosBurnTable.state())).states[2].heat,1);
  await page.screenshot({path:path.join(out,'restored.png')});
  report.phase='pixels';
  report.pixels=await page.evaluate(async()=>{
    window.__kaminosRenderSceneForInspection();
    const canvas=document.getElementById('kaminos-host-renderer-canvas'),image=new Image();image.src=canvas.toDataURL();await image.decode();
    const read=document.createElement('canvas');read.width=image.width;read.height=image.height;
    const ctx=read.getContext('2d');ctx.drawImage(image,0,0);const bytes=ctx.getImageData(0,0,read.width,read.height).data;
    let bright=0,orange=0;for(let i=0;i<bytes.length;i+=4){if(Math.max(bytes[i],bytes[i+1],bytes[i+2])>45)bright++;if(bytes[i]>100&&bytes[i]>bytes[i+1]*1.6&&bytes[i]>bytes[i+2]*2)orange++;}
    return {width:read.width,height:read.height,bright,orange};
  });
  assert.ok(report.pixels.bright>1000);assert.ok(report.pixels.orange>100);
  report.phase='mobile';await page.setViewportSize({width:430,height:932});await page.locator('#burn-table-frame').click();
  await page.screenshot({path:path.join(out,'mobile.png')});
  report.mobile=await page.evaluate(()=>({width:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  assert.equal(report.mobile.width,report.mobile.client);
  report.phase='mode-return';await page.getByRole('button',{name:'Authoring',exact:true}).click();await page.getByRole('button',{name:'Workbench',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.kaminosBurnTable.state())).objects.length,4);
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;await save();console.log(JSON.stringify(report));}
