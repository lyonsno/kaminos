import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('an unknown capture scope fails before browser launch instead of becoming a full run',()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'sinter-live-log-mode-'));
  const run=spawnSync(process.execPath,['tools/live-log-heat-witness.mjs',out],{cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,LIVE_LOG_WITNESS_MODE:'unknown',KAMINOS_URL:'http://127.0.0.1:1',CHROME_EXECUTABLE:'/missing-browser',PLAYWRIGHT_MODULE:'/missing-playwright'},encoding:'utf8'});
  assert.notEqual(run.status,0);const report=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
  assert.equal(report.phase,'preflight');assert.match(report.error,/Unknown live-log witness mode/);assert.deepEqual(report.frames,[]);
});
