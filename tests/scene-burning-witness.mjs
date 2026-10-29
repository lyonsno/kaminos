// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const source=fs.readFileSync(new URL('../tools/scene-burning-witness.mjs',import.meta.url),'utf8');
const start=source.indexOf('  assert.deepEqual(report.effective.gi'),end=source.indexOf('  report.burnLabelDraws=',start);
assert.ok(start>=0&&end>start);
const validate=Function('assert','report',source.slice(start,end));
const verify=effective=>validate(assert,{effective});
// Effective-route projection of native-r8/report.json, 2026-10-23.
const observed={backend:'WebGPU:apple',grid:32,rays:28,radius:.1,gi:{steps:4,slices:3},consumer:'kaminos.scene-burning.v1'};
verify(observed);
for(const patch of [{backend:'WebGL fallback'},{grid:48},{rays:96},{radius:.7},{gi:{steps:3,slices:3}},{consumer:'legacy-one-object'},{consumer:null}])assert.throws(()=>verify({...observed,...patch}));
const labelStart=source.indexOf('  assert.equal(report.burnLabelDraws'),labelEnd=source.indexOf('\n',labelStart);
assert.ok(labelStart>=0&&labelEnd>labelStart);
const verifyLabels=Function('assert','report',source.slice(labelStart,labelEnd));
verifyLabels(assert,{burnLabelDraws:0});
for(const burnLabelDraws of [undefined,null,1,6])assert.throws(()=>verifyLabels(assert,{burnLabelDraws}));
const out=fs.mkdtempSync(path.join(os.tmpdir(),'scene-burn-failed-launch-'));
const result=spawnSync(process.execPath,[new URL('../tools/scene-burning-witness.mjs',import.meta.url).pathname,'http://127.0.0.1:1',out],{env:{...process.env,CHROME_EXECUTABLE:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'},encoding:'utf8'});
assert.equal(result.status,1);
const failed=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
assert.equal(failed.status,'failed');assert.equal(failed.phase,'launch');assert.ok(failed.error);assert.deepEqual(failed.observations,[]);
