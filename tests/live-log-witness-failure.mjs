import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('a preflight failure still preserves phase and last trustworthy evidence',()=>{
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'sinter-live-log-harness-'));
  const env={...process.env};delete env.KAMINOS_URL;delete env.CHROME_EXECUTABLE;delete env.PLAYWRIGHT_MODULE;
  const run=spawnSync(process.execPath,['tools/live-log-heat-witness.mjs',out],{cwd:path.resolve(import.meta.dirname,'..'),env,encoding:'utf8'});
  assert.notEqual(run.status,0);const report=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
  assert.equal(report.status,'failed');assert.equal(report.phase,'preflight');assert.deepEqual(report.frames,[]);
  assert.match(report.error,/required/);
});
