// kaminos-test: node
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const out=mkdtempSync(join(tmpdir(),'joined-native-negative-'));
writeFileSync(join(out,'report.json'),JSON.stringify({status:'passed',oldFixture:true}));
const result=spawnSync(process.execPath,[fileURLToPath(new URL('./scene-joined-light-native.mjs',import.meta.url)),'/nonexistent-native-module',out],{env:{...process.env,PATH:'/nonexistent-git-path'},encoding:'utf8'});
assert.equal(result.status,1);
const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
assert.equal(report.status,'failed','source discovery failure must replace prior passing evidence');
assert.equal(report.phase,'source-discovery');assert.equal(report.source.revision,null);
assert.match(report.error,/git.*ENOENT/);assert.equal(report.oldFixture,undefined);
console.log('native pre-adapter failure replaces stale success',out);
