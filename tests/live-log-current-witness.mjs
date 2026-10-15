// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('witness launch refusal leaves a durable failure and no implied browser/backend',async()=>{
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'sinter-witness-refusal-'));
  const child=spawnSync(process.execPath,['tools/live-log-current-witness.mjs','http://127.0.0.1:1',out],{
    cwd:new URL('..',import.meta.url),encoding:'utf8',env:{...process.env,CHROME_EXECUTABLE:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',PLAYWRIGHT_MODULE:'/missing/driver'}});
  assert.equal(child.status,1);
  const report=JSON.parse(await fs.readFile(path.join(out,'report.json')));
  assert.equal(report.status,'failed');assert.equal(report.phase,'launch');assert.match(report.error,/Independent browser required/);
  assert.equal(report.browserVersion,undefined);assert.equal(report.effective,undefined);assert.deepEqual(report.frames,[]);
});
