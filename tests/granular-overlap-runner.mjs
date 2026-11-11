// kaminos-test: node
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'overlap-runner-')),out=path.join(root,'result');const child=spawnSync(process.execPath,['tools/granular-overlap-study.mjs','missing-config.json',out,'definitely-not-executing-source'],{encoding:'utf8'});
assert.notEqual(child.status,0);const report=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'));assert.equal(report.status,'failed');assert.equal(report.phase,'source-preflight');assert.match(report.error,/Requested source/);assert.equal(report.cases.length,0);assert.ok(report.source.commit);
