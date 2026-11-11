// Direct, isolated saved-asset inspection; no timing or performance comparison.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {assertSupportInspection} from '../trellis-support-evidence.mjs';
const [url,out,executable]=process.argv.slice(2);
if(!url||!out||!executable)throw Error('usage: node tools/trellis-support-witness.mjs URL OUTPUT_DIRECTORY INDEPENDENT_CHROMIUM');
await fs.mkdir(out,{recursive:true});const report={schema:'kaminos.trellis-support-witness.v1',url,executable,classification:'lightweight saved asset and local geometry inspection; no performance claim',status:'running',phase:'launch',captures:[],consoleErrors:[],pageErrors:[]};
let browser,context,profile;const assets=[];
const persist=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
await persist();
try{
  const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE??'playwright-core');
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'barycentric-support-browser-'));
  report.profile=profile;report.ownerPid=process.pid;await persist();
  context=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,viewport:{width:1400,height:1000},deviceScaleFactor:1,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});browser=context.browser();
  const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  page.on('response',r=>{if(r.url().includes('weathered-timber-beam.glb'))assets.push(r.body().then(b=>({url:r.url(),status:r.status(),bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}),e=>({url:r.url(),status:r.status(),bodyError:String(e)})));});
  report.phase='page-load';await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='trellis-support');
  report.phase='experiment-load';await page.waitForFunction(async()=>{try{return !!(await window.kaminosWorkbenchExperiments.read()).candidate;}catch{return false;}},{},{timeout:120000});
  report.initial=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());assert.equal(report.initial.backend,'WebGPU');assert.ok(report.initial.candidate.sourcePatchTriangles>0);assert.equal(report.initial.candidate.supportTriangles,12);
  const invoke=(op,arg)=>page.evaluate(({op,arg})=>window.kaminosWorkbenchExperiments.invoke(op,arg),{op,arg});
  await invoke('frame');await page.waitForTimeout(1200);
  report.phase='controls';await page.getByLabel('Region X',{exact:true}).click();await page.getByLabel('Region X',{exact:true}).fill('.16');await page.getByLabel('Region X',{exact:true}).press('Enter');
  await page.waitForFunction(async()=>{const s=await window.kaminosWorkbenchExperiments.read();return !s.pending&&s.region.origin[0]===.16;});
  await page.waitForTimeout(600);
  report.changed=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());assert.equal(report.changed.region.origin[0],.16);assert.equal(report.changed.pending,false);assert.notDeepEqual(report.initial.candidate.sourceTriangleIds,report.changed.candidate.sourceTriangleIds);
  await invoke('setRegion',{origin:report.initial.region.origin});
  const shoot=async(name)=>{await page.waitForTimeout(700);const filename=path.join(out,name+'.png');await page.screenshot({path:filename});report.captures.push(filename);};
  await page.getByRole('button',{name:'Frame region',exact:true}).click();await page.getByRole('combobox').filter({has:page.locator('option[value="partition"]')}).selectOption('partition');await shoot('region-partition');
  await invoke('setMode','source');await shoot('region-source');
  await invoke('setMode','support');await shoot('region-support');
  await invoke('setMode','lod');report.near=await invoke('setThreshold',1);assert.equal(report.near.effective,'source');report.far=await invoke('setThreshold',100000);assert.equal(report.far.effective,'support');
  await invoke('setMode','partition');await invoke('setThreshold',180);await invoke('frame');await shoot('whole-partition');
  report.phase='source-provenance';report.assets=await Promise.all(assets);report.sourceBytes=await page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Source fetch failed');const b=await r.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',b);return {url:r.url,bytes:b.byteLength,sha256:Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')};},report.initial.sourceUrl);assert.equal(report.sourceBytes.sha256,'7be0be2857ce5100ffa86f329e4068ba83ebb701c8582e2f982d28e68b8f8bdd');assert.equal(report.initial.candidate.originalTriangles,97670);
  report.runtime=await page.evaluate(()=>fetch('/api/runtime-config').then(r=>r.json()));
  report.codeHashes={};for(const name of ['trellis-local-support.mjs','trellis-support-gpu.mjs','experiments/trellis-support.experiment.mjs']){
    const local=await fs.readFile(new URL('../'+name,import.meta.url)),response=await fetch(new URL('/'+name,url));assert.ok(response.ok,'served module unavailable');const served=Buffer.from(await response.arrayBuffer()),hash=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(hash(local),hash(served),'served module differs from witness checkout');report.codeHashes[name]=hash(served);
  }
  report.final=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  report.phase='cleanup';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
  assertSupportInspection(report);
  report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=String(e.stack??e);process.exitCode=1;const page=context?.pages().at(-1);if(page)try{await page.screenshot({path:path.join(out,'failure.png')});report.failureText=await page.locator('body').innerText();}catch{} }
finally{await context?.close();await browser?.close();report.profile=profile;await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
