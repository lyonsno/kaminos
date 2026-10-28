// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Exercise the real witness's pre-browser failure path, not a report mock.
const out=fs.mkdtempSync(path.join(os.tmpdir(),'display-witness-negative-'));
const script=new URL('../scripts/check-display-reconstruction.mjs',import.meta.url).pathname;
const result=spawnSync(process.execPath,[script,process.cwd(),out+'/missing-source.json',out,out],{encoding:'utf8'});
assert.equal(result.status,1);
const report=JSON.parse(fs.readFileSync(out+'/report.json'));
assert.equal(report.ok,false);
assert.equal(report.phase,'source');
assert.match(report.error,/missing-source.json/);
assert.deepEqual(report.arms,[]);
assert.equal(report.executable,undefined);
console.log('display witness preserves pre-browser failure: pass');
