import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const [observedPath,assetPath]=process.argv.slice(2);if(!observedPath||!assetPath)throw Error('Observed native report and source asset required');
const baseline=JSON.parse(fs.readFileSync(observedPath)),directory=fs.mkdtempSync(path.join(os.tmpdir(),'affine-admission-'));
const cases=[
 ['failed-probe',r=>{r.observed.status='failed';},/passed native probe/],
 ['wrong-route',r=>{r.observed.resident[0].stages.find(s=>s.name==='released').state.route='fixture.cpu-fallback.v0';},/resident route/],
 ['wrong-kind',r=>{r.observed.resident[0].stages.find(s=>s.name==='released').state.kind='pmb';},/material kind/],
 ['duplicate-stage',r=>{r.observed.resident[0].stages[4].name='damaged';},/stage coverage/],
];
for(const [name,mutate,message] of cases){const input=structuredClone(baseline);mutate(input);const target=path.join(directory,name+'.json'),output=path.join(directory,name+'-report.json');fs.writeFileSync(target,JSON.stringify(input));const result=spawnSync(process.execPath,['structural-material-component-affine-assay.mjs',target,assetPath,output,'.24','[1,0,0,0.5]'],{encoding:'utf8'}),report=JSON.parse(fs.readFileSync(output));assert.notEqual(result.status,0,`${name} must fail before constructing geometry`);assert.equal(report.status,'failed');assert.equal(report.phase,'input');assert.match(report.failure.message,message);}
console.log('Failed, wrong-route, wrong-kind and incomplete native evidence rejects with durable input reports (controlled metadata fixtures)');
