// kaminos-test: node
import assert from 'node:assert/strict';
import {mkdtemp,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const scratch=await mkdtemp(join(tmpdir(),'kaminos-kiln-identity-'));
const out=join(scratch,'evidence'),store=join(scratch,'unopened-consumer');
const script=fileURLToPath(new URL('../scratch/beaming-kiln-hybrid-1013.mjs',import.meta.url));
const env={...process.env};delete env.GIT_DIR;delete env.GIT_WORK_TREE;env.GIT_CEILING_DIRECTORIES=scratch;
env.KAMINOS_PLAYWRIGHT_MODULE=join(scratch,'missing-playwright.mjs');
const result=spawnSync(process.execPath,[script,out,store,'http://127.0.0.1:1'],{cwd:scratch,env,encoding:'utf8'});
assert.equal(result.status,1);
const report=JSON.parse(await readFile(join(out,'kiln.json'),'utf8'));
assert.equal(report.status,'failed');assert.equal(report.failure.phase,'source-identity');
assert.equal(report.source,null);assert.match(report.failure.message,/git rev-parse HEAD/);
assert.equal(report.browser,undefined,'identity refusal must precede browser launch');
await assert.rejects(access(store),{code:'ENOENT'});
console.log('PASS failed source identity retains report before browser/store work: '+out);
const dependencyOut=join(scratch,'dependency-evidence');
const dependency=spawnSync(process.execPath,[script,dependencyOut,store,'http://127.0.0.1:1'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,encoding:'utf8'});
assert.equal(dependency.status,1);
const missing=JSON.parse(await readFile(join(dependencyOut,'kiln.json'),'utf8'));
assert.equal(missing.status,'failed');assert.equal(missing.failure.phase,'browser-dependency');
assert.match(missing.source,/^[a-f0-9]{40}$/);
assert.match(missing.failure.message,/missing-playwright/);
assert.equal(missing.browser,undefined,'missing dependency must precede browser launch');
await assert.rejects(access(store),{code:'ENOENT'});
console.log('PASS missing optional browser dependency retains report before store work');
for(const [label,softness,sampling]of [['sampling','1','blur'],['softness','-1','fixed']]){
 const target=join(scratch,label+'-evidence');
 const result=spawnSync(process.execPath,[script,target,store,'http://127.0.0.1:1',softness,'unused.kaminos.json',sampling],{cwd:scratch,env,encoding:'utf8'});
 assert.equal(result.status,1);
 const failure=JSON.parse(await readFile(join(target,'kiln.json'),'utf8'));
 assert.equal(failure.status,'failed');assert.equal(failure.failure.phase,'arguments');
 assert.equal(failure.source,null);assert.equal(failure.browser,undefined);assert.match(failure.failure.message,new RegExp(label));
 await assert.rejects(access(store),{code:'ENOENT'});
}
