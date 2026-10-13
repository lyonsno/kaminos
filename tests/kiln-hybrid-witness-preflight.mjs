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
const result=spawnSync(process.execPath,[script,out,store,'http://127.0.0.1:1'],{cwd:scratch,env,encoding:'utf8'});
assert.equal(result.status,1);
const report=JSON.parse(await readFile(join(out,'kiln.json'),'utf8'));
assert.equal(report.status,'failed');assert.equal(report.failure.phase,'source-identity');
assert.equal(report.source,null);assert.match(report.failure.message,/git rev-parse HEAD/);
assert.equal(report.browser,undefined,'identity refusal must precede browser launch');
await assert.rejects(access(store),{code:'ENOENT'});
console.log('PASS failed source identity retains report before browser/store work: '+out);
