// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('witness log-open failure leaves a terminal report before browser or server startup',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'neumip-launch-'));await fs.mkdir(path.join(out,'server.log'));
 const run=spawnSync(process.execPath,['tools/neumip-scene-witness.mjs',out],{encoding:'utf8'});
 assert.notEqual(run.status,0);const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
 assert.equal(report.status,'failed');assert.equal(report.phase,'launch');assert.match(report.error,/EISDIR/);
});
