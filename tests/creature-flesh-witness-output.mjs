// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'kaminos-contact-output-')),out=path.join(root,'retained');fs.mkdirSync(out);
const report='{"status":"passed","frames":["preserved"]}',frame='retained raw frame';fs.writeFileSync(path.join(out,'report.json'),report);fs.writeFileSync(path.join(out,'0001.png'),frame);
for(const args of [[],['--mode','held','--url','http://invalid.example/','--browser','absent','--playwright','absent','--root','absent','--revision','absent']]){
 const r=spawnSync(process.execPath,['tools/creature-flesh-witness.mjs','--out',out,...args],{encoding:'utf8'});
 assert.notEqual(r.status,0);assert.equal(fs.readFileSync(path.join(out,'report.json'),'utf8'),report,'occupied output must preserve prior report bytes');assert.equal(fs.readFileSync(path.join(out,'0001.png'),'utf8'),frame);
 const refusal=JSON.parse(r.stderr);assert.notEqual(path.dirname(refusal.report),out);assert.equal(JSON.parse(fs.readFileSync(refusal.report)).phase,'output-admission');
}
console.log('occupied witness output survives invalid invocation and attempted rerun');
