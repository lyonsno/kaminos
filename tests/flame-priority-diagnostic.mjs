// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const source=await fs.readFile(root+'/scripts/diagnose-flame-priority.mjs','utf8');
const validate=vm.runInNewContext(`(${source.match(/function validateArm\([\s\S]*?\n\}/)[0]})`,{assert});
test('requested jitter cannot stand in for effective jitter',()=>{
 const state={backend:'WebGPU:apple',simStepCount:96,opticalStepping:{effective:'numerical',tolerance:.01,quadratureJitter:false},controls:{flamePriority:0,raySteps:1,quadratureJitter:true,rayStartNoise:false}};
 assert.throws(()=>validate(state,0,true,96),/jitter|noise|false|true/);
});
test('missing browser dependency leaves a durable failure report',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'priority-negative-'));
 try{
  const dependency='/does-not-exist/priority-playwright/index.mjs';
  const text=source.replace('/Users/noahlyons/.local/state/kaminos/minion-visual-handoff-1004/browser-deps/node_modules/playwright-core/index.mjs',dependency);
  const script=dir+'/witness.mjs',out=dir+'/output';await fs.writeFile(script,text);
  const r=spawnSync(process.execPath,[script,root,out],{encoding:'utf8'});
  assert.notEqual(r.status,0);
  const exists=await fs.stat(out+'/report.json').then(()=>true,()=>false);
  assert.ok(exists,'dependency failure must preserve report.json');
  const report=JSON.parse(await fs.readFile(out+'/report.json'));assert.equal(report.ok,false);assert.equal(report.phase,'browser-dependency');assert.match(report.error,/priority-playwright/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('prepared count shader covers domain misses and scene clipping',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'priority-prepare-'));
 try{
  const r=spawnSync(process.execPath,[root+'/scripts/diagnose-flame-priority.mjs',root,dir+'/output','--prepare-only'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const core=await fs.readFile(dir+'/output/effective-volume-core.js','utf8');
  const miss=core.slice(core.indexOf('if (!fullGridCapture && min(hit.y, sceneDepthEndT)'),core.indexOf('let steps = select(clamp(u.viewport_steps_density.z'));
  assert.match(miss,/if \(DIAG_COUNTS\)/,'miss must explicitly emit zero counts');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('retention includes the observed reactant sidecar API and fails closed',()=>{
 assert.match(source,/await[^;]*sampleReactantFields\(/,'live guide input must be retained');
 assert.match(source,/assert\.ok\(report\.fieldExport\.ok/,'required export failure cannot become success');
});
test('complete blank beauty and count buffers are rejected',()=>{
 const condition=source.match(/if\((!s\.ok[^\n]+?)\)throw Error/)[1];
 const blank={ok:true,image:{width:1,height:1,rgba:[0,0,0,255]}};
 assert.equal(vm.runInNewContext(condition,{s:blank}),true);
 assert.equal(vm.runInNewContext(condition,{s:{...blank,image:{...blank.image,rgba:[5,0,0,255]}}}),false);
});
test('constraint isolation retains the complete factorial and effective shader switches',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'priority-constraints-'));
 try{
  const r=spawnSync(process.execPath,[root+'/scripts/diagnose-flame-priority.mjs',root,dir+'/output','--prepare-only','--constraints'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const report=JSON.parse(await fs.readFile(dir+'/output/report.json'));
  assert.ok(Array.isArray(report.armPlan),'constraint arms must be declared before capture');
  assert.deepEqual(report.armPlan.filter(x=>x.priority===.75).map(x=>x.constraints),[0,1,2,3,4,5,6,7]);
  const {label:first,...firstArm}=report.armPlan[0],{label:last,...lastArm}=report.armPlan.at(-1);
  assert.notEqual(first,last);assert.deepEqual(firstArm,lastArm);
  const core=await fs.readFile(dir+'/output/effective-volume-core.js','utf8');
  assert.match(core,/if \(\(DIAG_CONSTRAINTS & 1u\) != 0u\) \{ minimum = dtBase; \}/);
  assert.match(core,/if \(\(DIAG_CONSTRAINTS & 2u\) != 0u\) \{ maximum = dtBase \* 4\.0; \}/);
  assert.match(core,/if \(\(DIAG_CONSTRAINTS & 4u\) != 0u\) \{ stop = remaining; \}/);
  assert.match(core,/DIAG_CONSTRAINTS:globalThis\.__priorityDiagnostic\?\.constraints\|\|0/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('floor repair preserves a separate baseline and clamps the actual child width',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'priority-floor-'));
 try{
  const r=spawnSync(process.execPath,[root+'/scripts/diagnose-flame-priority.mjs',root,dir+'/output','--prepare-only','--repair-floor'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const report=JSON.parse(await fs.readFile(dir+'/output/report.json'));
  for(const p of [0,.00133,.001333,.1,.5,.75,1])assert.deepEqual(report.armPlan.filter(x=>x.priority===p&&x.label!=='zero-repeat').map(x=>x.repair),[false,true]);
  const optical=await fs.readFile(dir+'/output/effective-volume-optical-native.mjs','utf8');
  assert.match(optical,/DIAG_REPAIR_FLOOR && \(\*s\)\.positions\[2\] < \(\*s\)\.minimum/);
  assert.match(optical,/\(\*s\)\.width = \(\*s\)\.minimum;\s*\(\*s\)\.mask = 1u;\s*opticalStepResetPositions\(s\);\s*return;/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
