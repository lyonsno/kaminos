import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [origin,out]=process.argv.slice(2);
if(!origin||!out)throw Error('Usage: live-log-collision-witness.mjs <origin> <output>');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'source',repoRoot:path.resolve(import.meta.dirname,'..'),requested:{route:'real-log-heat-kernel/synthetic-contact',grid:8,steps:600},executable:process.env.CHROME_EXECUTABLE};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));let browser;
try{
  await save();report.sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
  assert.ok(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'),'Independent browser required');
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  report.phase='launch';await save();
  browser=await chromium.launch({executablePath:report.executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
  const page=await browser.newPage();page.setDefaultTimeout(0);report.browserVersion=browser.version();report.sources=[];
  for(const name of ['live-log-heat-gpu.mjs','live-log-heat-core.mjs','live-log-surface-mask.mjs','tools/live-log-collision-fixture.html']){
    const actual=await(await page.request.get(origin+'/'+name)).body(),expected=await fs.readFile(path.join(report.repoRoot,name));
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(sha(actual),sha(expected),name);report.sources.push({name,sha256:sha(actual)});
  }
  report.phase='kernel';await save();await page.goto(origin+'/tools/live-log-collision-fixture.html');
  await page.waitForFunction(()=>window.runLogCollisionFixture);
  report.result=await page.evaluate(()=>window.runLogCollisionFixture());await save();
  assert.deepEqual(report.result.errors,[]);
  for(const arm of ['overlap','collision']){const row=report.result.rows.find(r=>r.arm===arm);assert.ok(row.peak[1]>.5,arm+' must char from external hot gas');assert.ok(row.peak[2]>0,arm+' must react');}
  for(const arm of ['cold','blocked']){const row=report.result.rows.find(r=>r.arm===arm);assert.deepEqual(row.peak,[0,0,0,0],arm+' must not acquire remote heat');}
  report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();await save();}
