import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const [origin,out]=process.argv.slice(2);if(!origin||!out)throw Error('Usage: scene-solid-gpu-witness.mjs <origin> <output>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repoRoot:path.resolve(import.meta.dirname,'..'),requested:{backend:'WebGPU',reference:'CPU conservative shell and per-object exterior fill'},errors:[]};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));let browser;
try{
 await save();report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 report.executable=process.env.CHROME_EXECUTABLE;assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'),'Independent Chromium required');
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=await browser.newPage();page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 report.phase='load';await save();await page.goto(origin+'/tools/scene-solid-gpu-fixture.html');await page.waitForFunction(()=>window.fixtureLoaded);
 report.phase='conformance';await save();report.effective=await page.evaluate(()=>window.runSolidConformance());
 assert.equal(report.effective.backend,'WebGPU');assert.equal(report.effective.results.length,10);
 for(const result of report.effective.results){assert.equal(result.receipt.backend,'gpu');assert.ok(result.expected.some(Boolean));assert.equal(result.actual.length,result.expected.length);assert.deepEqual(result.different,[],result.name+' height '+result.height);}
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await save();}
