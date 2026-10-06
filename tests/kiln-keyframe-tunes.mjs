import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultKilnCues, normalizeKilnCues, createKilnPerformance} from '../kiln-cinematic-cues.mjs';
import * as tunes from '../kiln-cue-tunes.mjs';

const tune = exposure => ({domControls:{
  'volume-physical-exposure':{value:exposure,type:'range'},
  'volume-flow-rate':{value:2,type:'range'},
  'volume-input-radius':{value:.4,type:'range'},
  'volume-resolution':{value:64,type:'select'},
  'hidden-detail':{value:.123456789,type:'range'},
},rendererControls:{},presentationControls:{},source:{presetId:'original',label:'Original basin'}});

test('cue roundtrip retains a complete tune including hidden values and source provenance', () => {
  const cues=defaultKilnCues();
  cues.ignition[0].tune=tune(-3);
  const saved=normalizeKilnCues(cues);
  assert.deepEqual(saved.ignition[0].tune,cues.ignition[0].tune);
  saved.ignition[0].tune.domControls['hidden-detail'].value=0;
  assert.equal(cues.ignition[0].tune.domControls['hidden-detail'].value,.123456789);
});

test('native decimal roundtrip permits representation noise but refuses actual parameter substitution',()=>{
  assert.equal(typeof tunes.cueTuneValuesEqual,'function','cue application needs a decimal conformance check');
  assert.equal(tunes.cueTuneValuesEqual(tune(.45499999999999996),tune(.455)),true);
  assert.equal(tunes.cueTuneValuesEqual(tune(.45499999999999996),tune(.46)),false);
  const missing=tune(.455);delete missing.domControls['hidden-detail'];
  assert.equal(tunes.cueTuneValuesEqual(tune(.455),missing),false);
});

test('performance blends supported appearance and emission while preserving hidden coefficients', () => {
  const cues=defaultKilnCues();
  cues.ignition=[{time:0,radius:.1,flow:0,tune:tune(-4)},{time:2,radius:.5,flow:2,tune:tune(-2)}];
  let clock=0;
  const run=createKilnPerformance(cues,{now:()=>clock});run.start('preview');clock=1;
  const sample=run.sample();
  assert.equal(sample.tune.domControls['volume-physical-exposure'].value,-3);
  assert.ok(Math.abs(sample.tune.domControls['volume-input-radius'].value-.3)<1e-12);
  assert.equal(sample.tune.domControls['volume-flow-rate'].value,1);
  assert.equal(sample.tune.domControls['hidden-detail'].value,.123456789);
});
