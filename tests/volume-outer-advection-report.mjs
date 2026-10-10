import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const root=process.argv[2]||mkdtempSync(resolve(tmpdir(),'outer-advection-report-'));
mkdirSync(root,{recursive:true});
for(const cached of [false,true]){
 const out=resolve(root,cached?'cached':'fresh');mkdirSync(out,{recursive:true});
 if(cached)writeFileSync(resolve(out,'report.json'),JSON.stringify({phase:'complete',passed:true,source:{revision:'prior-success'}}));
 const run=spawnSync(process.execPath,[new URL('./volume-outer-advection-gpu.mjs',import.meta.url).pathname,'unused-dawn-path',out,'missing-outer-source-for-report-test'],{encoding:'utf8'});
 assert.notEqual(run.status,0);
 assert.ok(existsSync(resolve(out,'report.json')),'source failure must produce a terminal report');
 const r=JSON.parse(readFileSync(resolve(out,'report.json'),'utf8'));
 assert.equal(r.passed,false,'cached success must not survive a failed replay');
 assert.equal(r.phase,'source-resolution');assert.match(r.error,/missing-outer-source-for-report-test/);
}
console.log('source replay failure reports fresh and replaces cached success passed');
