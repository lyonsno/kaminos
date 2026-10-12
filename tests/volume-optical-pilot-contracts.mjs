import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'optical-pilot-contract-'));
for(const [step,yaw,reason] of [['bad','0',/invalid held step/],['197','bad',/invalid camera yaw/]]) {
  const target=path.join(out,step+'-'+yaw);
  const run=spawnSync(process.execPath,['scripts/capture-optical-trace.mjs',root,'/missing-optical-fixture',target,'18641','576',step,yaw],{cwd:root,encoding:'utf8'});
  assert.equal(run.status,1);
  const report=JSON.parse(fs.readFileSync(target+'/report.json'));
  assert.equal(report.status,'failed');assert.equal(report.phase,'inputs');
  assert.match(report.error,reason);
}
console.log('invalid pilot state/view requests fail before fixture loading with durable reports');
