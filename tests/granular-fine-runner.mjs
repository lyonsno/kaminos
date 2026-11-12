// kaminos-test: node
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fine-runner-'));
const child=spawnSync(process.execPath,['tools/granular-fine-study.mjs','absent.json',dir,'wrong-source'],{encoding:'utf8'});assert.notEqual(child.status,0);
const report=JSON.parse(await fs.readFile(path.join(dir,'manifest.json')));assert.equal(report.status,'failed');assert.equal(report.phase,'source-preflight');assert.match(report.error,/source/i);assert.deepEqual(report.cases,[]);assert.ok(report.source.commit);
