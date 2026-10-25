// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('photograph scene witness writes a failure before browser setup on missing inputs',()=>{
  const source=new URL('../material-photo-scene-witness.mjs',import.meta.url);
  assert.ok(existsSync(source),'scene witness missing');
  const out=mkdtempSync(join(tmpdir(),'photo-scene-witness-'));
  const run=spawnSync(process.execPath,[source.pathname,'--out',out],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  const report=JSON.parse(readFileSync(join(out,'report.json')));
  assert.equal(report.status,'failed');assert.equal(report.phase,'arguments');assert.match(report.error,/required/);
});
