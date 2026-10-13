// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'sequence-command-'));
for(const [label,args]of [['missing-input',[]],['unknown-option',['--wrong','x']]]){
 const out=path.join(root,label);
 const result=spawnSync(process.execPath,[new URL('../tools/render-fluid-sequence.mjs',import.meta.url).pathname,'--out',out,...args],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 const raw=await fs.readFile(path.join(out,'sequence.json'),'utf8').catch(()=>null);
 assert.ok(raw,'Export failure before first frame must retain a durable failed manifest: '+label);
 const report=JSON.parse(raw);assert.equal(report.status,'failed');assert.equal(report.complete,false);assert.equal(report.completedFrames,0);assert.ok(report.failurePhase);
}
console.log('Command input/argument failures retain their phase before any browser/frame');
