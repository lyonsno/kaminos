import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertSurfaceSceneResult} from './surface-splat-scene-verdict.mjs';
const [origin,out,materialFixture]=process.argv.slice(2);if(!origin||!out)throw Error('Usage: node tools/surface-splat-scene-witness.mjs ORIGIN OUT [MATERIAL_FIXTURE_URL]');
await fs.mkdir(out,{recursive:true});
const report={ok:false,phase:'launch',origin,repoRoot:path.resolve(import.meta.dirname,'..'),executable:process.env.CHROME_EXECUTABLE,errors:[],sources:[]};let browser,page;
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();
try{
 assert(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'),'Independent Chromium required');
 report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 report.dirty=!!execFileSync('git',['status','--porcelain'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,args:['--use-angle=metal','--enable-unsafe-webgpu','--use-mock-keychain','--password-store=basic']});page=browser.pages()[0];page.setDefaultTimeout(0);
 let fail;const failure=new Promise((_,reject)=>fail=reject);failure.catch(()=>{});
 const pageFailure=e=>{report.errors.push(String(e));fail(Error(String(e)));};
 page.on('pageerror',pageFailure);page.on('console',m=>{if(m.type()==='error')pageFailure(m.text());});
 await page.route('**/favicon.ico',r=>r.fulfill({status:204}));
 report.phase='source';await save();
 for(const name of ['surface-splat-object.mjs','surface-splat-glb.mjs','deferred-surface-splats.mjs','surface-field-material.mjs','scene-solid-gpu.mjs','volume-scene-solid.mjs','ash/scene-object.mjs','tools/surface-splat-scene-fixture.html']){
  const served=await (await page.request.get(origin+'/'+name)).body(),local=await fs.readFile(path.join(report.repoRoot,name)),hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(served),hash(local),name);report.sources.push({name,sha256:hash(served)});
 }
 report.phase='load';await save();await page.goto(origin+'/tools/surface-splat-scene-fixture.html');await Promise.race([page.waitForFunction(()=>window.fixtureLoaded),failure]);report.phase='native';await save();
 report.result=await Promise.race([page.evaluate(url=>window.runSurfaceScene(url),materialFixture),failure]);const r=report.result;
 await fs.writeFile(out+'/combined.png',Buffer.from(r.image.split(',')[1],'base64'));delete r.image;
 assertSurfaceSceneResult(r,{materialFixture:!!materialFixture,backend:process.argv.includes('--negative-route')?'fallback':'webgpu'});
 assert.deepEqual(report.errors,[]);report.phase='complete';report.ok=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await browser?.close();await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error}));}
