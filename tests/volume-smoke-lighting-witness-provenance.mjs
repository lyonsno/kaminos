import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=mkdtempSync(resolve(tmpdir(),'kaminos-lighting-provenance-'));
// A non-repository caller must not determine source identity. Missing runtime
// also witnesses durable failure reporting without GPU work.
const result=spawnSync(process.execPath,[resolve(root,'tests/volume-smoke-lighting-gpu.mjs'),
  resolve(out,'intentional-missing-runtime.mjs'),out],{cwd:out,encoding:'utf8'});
const report=JSON.parse(readFileSync(resolve(out,'report.json'),'utf8'));
assert.equal(result.status,1);
assert.equal(report.passed,false);
assert.equal(report.source?.root,root.replace(/\/$/,''));
assert.equal(report.source.revision,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
assert.equal(report.phase,'adapter');
assert.match(report.error,/ERR_MODULE_NOT_FOUND/);
console.log('witness source identity is independent of caller cwd; failure retained at '+out);
