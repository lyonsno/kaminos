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
test('server log handle is closed explicitly after spawning the child',async()=>{
 const block=source.slice(source.indexOf("const log=await fs.open(out+'/server.log'"),source.indexOf('await new Promise((resolve,reject)'));
 const calls=[];
 await vm.runInNewContext(`(async()=>{${block}})()`,{
  fs:{open:async()=>({fd:13,close:async()=>calls.push('close')})},out:'/unused',root,home:'/unused',process:{env:{}},
  spawn:()=>{calls.push('spawn');return {};},
 });
 assert.deepEqual(calls,['spawn','close']);
 calls.length=0;
 await assert.rejects(vm.runInNewContext(`(async()=>{${block}})()`,{
  fs:{open:async()=>({fd:13,close:async()=>calls.push('close')})},out:'/unused',root,home:'/unused',process:{env:{}},
  spawn:()=>{calls.push('spawn');throw Error('spawn failed');},
 }),/spawn failed/);
 assert.deepEqual(calls,['spawn','close']);
});
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
  assert.match(optical,/if \(\(\*s\)\.mask > 1u \|\| \(\*s\)\.floorRetry\) \{ return; \}/,'a floor retry must not be reset by guide/phase constraints');
  assert.match(optical,/DIAG_REPAIR_FLOOR && \(\*s\)\.positions\[2\] < \(\*s\)\.minimum/);
  assert.match(optical,/\(\*s\)\.width = \(\*s\)\.minimum;\s*\(\*s\)\.mask = 1u;\s*\(\*s\)\.floorRetry = true;\s*opticalStepResetPositions\(s\);\s*return;/);
  assert.match(optical,/\(\*s\)\.floorRetry = false;\s*\(\*s\)\.cursor = min/,'accepted interval must re-enable guidance');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('continuous weighting is isolated from the original support lookahead',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'priority-smooth-'));
 try{
  const r=spawnSync(process.execPath,[root+'/scripts/diagnose-flame-priority.mjs',root,dir+'/output','--prepare-only','--smooth-floor'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const report=JSON.parse(await fs.readFile(dir+'/output/report.json'));
  for(const p of [.001333,.1,.75,1])assert.deepEqual(report.armPlan.filter(x=>x.priority===p).map(x=>[x.repair,x.smooth]),[[false,false],[true,false],[false,true],[true,true]]);
  const core=await fs.readFile(dir+'/output/effective-volume-core.js','utf8');
  assert.match(core,/if \(DIAG_SMOOTH_GUIDE\) \{ support = flameGuideContinuousAt/);
  const sampling=await fs.readFile(dir+'/output/effective-volume-raymarch-sampling.mjs','utf8');
  assert.match(sampling,/support \+= cue \* weight.x \* weight.y \* weight.z/);
  assert.match(sampling,/let support = flameGuideAtPadded\(point, padding\)/,'original lookahead must remain unchanged');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('fixed reference changes quadrature width without changing material footprint',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'priority-reference-'));
 try{
  const r=spawnSync(process.execPath,[root+'/scripts/diagnose-flame-priority.mjs',root,dir+'/output','--prepare-only','--reference'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const report=JSON.parse(await fs.readFile(dir+'/output/report.json'));
  assert.deepEqual(report.armPlan.filter(x=>x.reference).map(x=>x.reference),[1,2,4,8,16]);
  assert.deepEqual(report.armPlan.filter(x=>x.guide===1).map(x=>[x.priority,x.constraints]),[[.1,6],[.5,6],[.75,6],[1,6]]);
  assert.ok(report.armPlan.filter(x=>x.reference).every(x=>x.priority===0&&!x.jitter));
  const optical=await fs.readFile(dir+'/output/effective-volume-optical-native.mjs','utf8');
  assert.match(optical,/s.minimum = base \/ f32\(DIAG_REFERENCE_PANELS\);\s*s.maximum = s.minimum;/);
  assert.match(optical,/DIAG_REFERENCE_PANELS == 0u && OPTICAL_STEP_MODE == 2u && refine/);
  const core=await fs.readFile(dir+'/output/effective-volume-core.js','utf8');
  const original=await fs.readFile(dir+'/output/original-volume-core.js','utf8');
  assert.equal(core.match(/let dtBase = [^;]+;/)[0],original.match(/let dtBase = [^;]+;/)[0]);
  assert.deepEqual(core.match(/boundarySidecarStepFootprintWidth = [^;]+;/g),original.match(/boundarySidecarStepFootprintWidth = [^;]+;/g));
  assert.match(source,/assert.equal\(effective.DIAG_REFERENCE_PANELS,reference\)/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('allocation compares error policies without spatial width constraints',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'priority-allocation-'));
 try{
  const r=spawnSync(process.execPath,[root+'/scripts/diagnose-flame-priority.mjs',root,dir+'/output','--prepare-only','--allocation'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const report=JSON.parse(await fs.readFile(dir+'/output/report.json'));
  for(const allocation of [1,2,3])assert.deepEqual(report.armPlan.filter(x=>x.allocation===allocation).map(x=>x.budget),[.01,.03,.1]);
  const optical=await fs.readFile(dir+'/output/effective-volume-optical-native.mjs','utf8');
  assert.match(optical,/if \(DIAG_ALLOCATION > 0u\) \{ s.minimum = base \/ 16.0; \}/);
  assert.match(optical,/disagreement.xyz \/ \(vec3<f32>\(1.0\) \+ max\(abs\(projectedFine\), abs\(projectedCoarse\)\)\)/);
  assert.match(optical,/DIAG_ALLOCATION == 1u \|\| DIAG_ALLOCATION == 2u/);
  const core=await fs.readFile(dir+'/output/effective-volume-core.js','utf8');
  assert.match(core,/if \(DIAG_ALLOCATION == 0u && OPTICAL_STEP_MODE == 2u && priority > 0.0/);
  assert.match(core,/allocationTolerance \/= 1.0 \+ 3.0 \* clamp\(u.occupancy_controls.z, 0.0, 1.0\) \* flameGuideContinuousAt\(midpoint\)/);
  assert.match(source,/assert.equal\(effective.DIAG_ALLOCATION,allocation\)/);
  assert.match(source,/assert.equal\(effective.DIAG_ALLOCATION_BUDGET,budget\)/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('growth comparison changes widening only, with paired controls',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'priority-growth-'));
 try{
  const r=spawnSync(process.execPath,[root+'/scripts/diagnose-flame-priority.mjs',root,dir+'/output','--prepare-only','--growth'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  const report=JSON.parse(await fs.readFile(dir+'/output/report.json'));
  const arms=report.armPlan.filter(x=>x.allocation);
  assert.equal(arms.length,10);
  for(const allocation of [1,2,3]){
   const pair=arms.filter(x=>x.allocation===allocation&&x.budget<.1);
   assert.deepEqual(pair.map(x=>x.growth),[false,true]);
   const normalized=pair.map(({label,growth,...x})=>x);
   assert.deepEqual(normalized[0],normalized[1]);
  }
  for(const allocation of [1,2])assert.deepEqual(arms.filter(x=>x.allocation===allocation&&x.budget===.1).map(x=>x.growth),[false,true]);
  assert.deepEqual(report.armPlan.filter(x=>x.label.startsWith('cell-')).map(x=>[x.priority,x.growth]),[[.75,false],[.75,true]]);
  const optical=await fs.readFile(dir+'/output/effective-volume-optical-native.mjs','utf8');
  assert.match(optical,/if \(DIAG_GROWTH && any\(comparison > vec4<f32>\(tolerance \* 0.125\)\)\) \{ nextWidth = \(\*s\).width; \}/);
  assert.match(source,/assert.equal\(effective.DIAG_GROWTH,growth\)/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
