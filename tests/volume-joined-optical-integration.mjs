// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as optics from '../volume-world-smoke-optics.mjs';
import {opticalSteppingConfig,resolveOpticalStepping} from '../volume-optical-native.mjs';
import {joinedComparisonPlan,validateJoinedArm,replaceOnce,main} from '../scripts/compare-joined-optics.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('joined emissive beauty executes the requested fixed or adaptive integrator',()=>{
  for(const mode of ['fixed','numerical','fixed-dense']) {
    const config=opticalSteppingConfig({mode});
    const effective=resolveOpticalStepping(config,{emissive:true,exterior:true,explicit:true});
    assert.equal(effective.mode,mode);
    assert.equal(effective.reason,null);
  }
});

test('joined intervals split entry, blend shoulders and exit without discarding a tail',()=>{
  assert.equal(typeof optics.joinedOpticalRegion,'function','joined interval policy is available');
  const args={end:12,fine:[3,7],inner:[3.25,6.75],fineBase:.5,worldBase:2,band:.25};
  const expected=[[0,3,2],[3,3.25,.25],[3.25,6.75,.5],[6.75,7,.25],[7,12,2]];
  for(const [cursor,stop,base] of expected) {
    assert.deepEqual(optics.joinedOpticalRegion(cursor,args),{stop,base});
  }
  assert.deepEqual(optics.joinedOpticalRegion(0,{...args,fine:[7,3],inner:[7,3]}),{stop:12,base:2});
  assert.deepEqual(optics.joinedOpticalRegion(4,{...args,inner:[7,3]}),{stop:7,base:.25},'grazing ray stays in blend');
  assert.deepEqual(optics.joinedOpticalRegion(0,{...args,fine:[-1,2],inner:[-.75,1.75]}),{stop:1.75,base:.5},'camera starts inside');
  const tiny=Math.fround(1e-7);
  assert.equal(optics.joinedOpticalRegion(0,{...args,end:tiny,fine:[-1,1],inner:[-.5,.5]}).stop,tiny);
});

test('production joined probes use the same transfer integrator on both sides',()=>{
  const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
  const gate=core.match(/let opticalStepping = ([^;]+);/)[1];
  assert.doesNotMatch(gate,/!worldActive/,'world material may not silently bypass the selected integrator');
  const exterior=core.slice(core.indexOf('if(worldActive && !fineRayInterval)'),core.indexOf('let flowKernelReconstructionActive',core.indexOf('if(worldActive && !fineRayInterval)')));
  assert.match(exterior,/opticalStepObserveWithTolerance/,'exterior participates in nested quadrature');
  assert.match(core,/joinedOpticalConstrain\(&opticalStep/,'candidate intervals account for both grid boundaries');
});

test('comparison admission uses live world-field state and rejects fallback, stale controls and wrong noise',()=>{
  const arm=joinedComparisonPlan()[0];
  const state={backend:'WebGPU:apple',simStepCount:192,error:null,worldSmoke:{effective:'one-way-world-field',steps:192},
    opticalStepping:{effective:arm.mode,integrationDomain:'joined-fine-world'},
    controls:{raySteps:arm.steps,adaptiveRays:arm.adaptive,rayStartNoise:arm.noise,rayNoiseAnimated:false,quadratureJitter:false}};
  validateJoinedArm(state,arm,192);
  for(const patch of [{backend:'fallback'},{simStepCount:193},{worldSmoke:{effective:'off'}},
    {opticalStepping:{effective:'fixed',integrationDomain:'joined-fine-world'}},
    {opticalStepping:{effective:arm.mode,integrationDomain:'fine'}},
    {controls:{...state.controls,raySteps:8}},{controls:{...state.controls,rayStartNoise:true}}])
    assert.throws(()=>validateJoinedArm({...state,...patch},arm,192),assert.AssertionError);
  for(const noise of [false,true])for(const orbit of [0,.06])for(const mode of ['uniform','old-adaptive','numerical'])
    for(const steps of [7,8,9,31,32,33])assert.ok(joinedComparisonPlan().some(a=>a.noise===noise&&a.orbit===orbit&&a.label.startsWith(mode+'-')&&a.steps===steps));
  assert.throws(()=>replaceOnce('missing','anchor','replacement'),/unique/);
  assert.throws(()=>replaceOnce('aa','a','replacement'),/unique/);
});

test('failure before browser launch leaves the source failure in a durable report',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'joined-optics-failure-'));
  const previous=process.exitCode;
  try{
    await fs.mkdir(tmp+'/run');
    await main(tmp,tmp+'/run','http://127.0.0.1:1','unused.kaminos.json');
    const report=JSON.parse(await fs.readFile(tmp+'/run/report.json'));
    assert.equal(report.status,'failed');assert.equal(report.phase,'source');
    assert.match(report.error,/script and source checkout differ/);
    assert.equal(report.arms.length,0);
  }finally{process.exitCode=previous;await fs.rm(tmp,{recursive:true,force:true});}
});
