// kaminos-test: node
import assert from 'node:assert/strict';
import {assertCoarseWitnessSource} from '../tools/fracture-coarse-witness-contract.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const input={initial:{source:'/source-A.glb',prepared:{receipt:{sourceTriangles:100}},material:{backend:'webgpu-avbd'}},runtime:{config:{source:{commit:'test-commit'}}},commit:'test-commit',spec:{source:'/source-A.glb',triangles:100,sha256:'asset-A-digest'},digest:'asset-A-digest'};
assert.doesNotThrow(()=>assertCoarseWitnessSource(input));
assert.throws(()=>assertCoarseWitnessSource({...input,initial:{...input.initial,source:'/source-B.glb'}}),/source.*identity/i,'Different sources with equal triangle counts must be rejected');
assert.throws(()=>assertCoarseWitnessSource({...input,initial:{...input.initial,material:{backend:'cpu-fallback'}}}),/solver/);
assert.throws(()=>assertCoarseWitnessSource({...input,digest:'asset-B-digest'}),/bytes/);
assert.throws(()=>assertCoarseWitnessSource({...input,commit:'stale-commit'}),/revision/);
const out=fs.mkdtempSync(path.join(os.tmpdir(),'coarse-witness-preflight-')),run=spawnSync(process.execPath,[new URL('../tools/fracture-coarse-witness.mjs',import.meta.url).pathname,'http://127.0.0.1:1/',out,path.join(out,'missing-spec.json')]);
assert.notEqual(run.status,0);assert.ok(fs.existsSync(path.join(out,'report.json')),'Failure before browser launch must still retain a report');
const failed=JSON.parse(fs.readFileSync(path.join(out,'report.json')));assert.equal(failed.status,'failed');assert.equal(failed.phase,'input');assert.ok(failed.error.includes('missing-spec.json'));
console.log('coarse witness binds effective source, digest, backend and revision');
