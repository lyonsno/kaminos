// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as training from '../neumip-training.mjs';
test('author spatial recipe initializes a neutral offset while retaining deterministic independent appearance fields',()=>{
 const model=training.createNeumipStudent({resolution:4,seed:37,trainingRecipe:'author-web-spatial-v1'});
 assert.ok(model.offset.data.every(v=>v===0),'author offset initialization must be zero');
 const legacy=training.createNeumipStudent({resolution:4,seed:37});
 assert.deepEqual([...model.mips[0].data],[...legacy.mips[0].data].map(v=>v*2),'author appearance initialization uses .1 standard deviation');
 assert.ok(model.mips[0].data.some(v=>v!==0));assert.deepEqual(model,training.createNeumipStudent({resolution:4,seed:37,trainingRecipe:'author-web-spatial-v1'}));
 assert.throws(()=>training.createNeumipStudent({resolution:4,trainingRecipe:'misspelled'}),/recipe/i);
});
test('raw appearance damping follows the author early-training boundary',()=>{
 const damp=step=>training.neumipSpatialTrainingState('author-web-spatial-v1',step).dampAppearance;
 for(const step of [0,100,2900])assert.equal(damp(step),true);
 for(const step of [1,99,101,2999,3000,3100])assert.equal(damp(step),false);
 assert.equal(training.neumipSpatialTrainingState('legacy-unsmoothed-v1',0).dampAppearance,false);
});
test('the selected spatial curriculum retains its published sigma, offset floor and field-freeze boundary',()=>{
 assert.equal(typeof training.neumipSpatialTrainingState,'function','spatial recipe state must be explicit in runtime receipts');
 const state=step=>training.neumipSpatialTrainingState('author-web-spatial-v1',step);
 assert.equal(state(0).appearanceSigma,8);assert.equal(state(10000).appearanceSigma,1);assert.equal(state(10000).offsetSigma,1);assert.equal(state(10001).trainOffsetField,false);assert.equal(state(10000).trainOffsetField,true);
 assert.equal(state(30000).appearanceSigma,.1);assert.equal(state(30000).offsetSigma,1);
 assert.deepEqual(training.neumipSpatialTrainingState('legacy-unsmoothed-v1',30000),{recipe:'legacy-unsmoothed-v1',step:30000,appearanceSigma:0,offsetSigma:0,trainOffsetField:true,dampAppearance:false});
 assert.throws(()=>state(-1),/step/i);assert.throws(()=>training.neumipSpatialTrainingState('unknown',0),/recipe/i);
});
