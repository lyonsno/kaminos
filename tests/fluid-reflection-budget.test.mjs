import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load=()=>import('../fluid-reflection-budget.mjs').catch(()=>({}));
test('reflection policy keeps the full baseline and admits an explicit weak-Fresnel approximation',async()=>{
  const m=await load();assert.equal(typeof m.resolveReflectionBudget,'function');
  assert.deepEqual(m.resolveReflectionBudget(),{mode:'full',fresnelCutoff:.04});
  assert.equal(m.reflectionSceneRayCount(.02037,{mode:'adaptive',fresnelCutoff:.04},5),0);
  assert.equal(m.reflectionSceneRayCount(.1,{mode:'adaptive',fresnelCutoff:.04},5),5);
  assert.equal(m.reflectionSceneRayCount(.7,{mode:'single',fresnelCutoff:.04},9),1);
  assert.equal(m.reflectionSceneRayCount(.02037,{mode:'full',fresnelCutoff:.04},9),9);
  for(const value of [-.01,1.01,NaN,Infinity])assert.throws(()=>m.resolveReflectionBudget({mode:'adaptive',fresnelCutoff:value}));
  assert.throws(()=>m.resolveReflectionBudget({mode:'magic'}));
});
test('switching A/B changes only the reflection policy, with explicit selected/effective state',async()=>{
  const m=await load();assert.equal(typeof m.createReflectionComparison,'function');
  const calls=[];const comparison=m.createReflectionComparison({apply:p=>{calls.push(p);return p;}});
  assert.equal(comparison.read().selected,'A');
  comparison.select('B');assert.deepEqual(calls[0],{mode:'adaptive',fresnelCutoff:.04});
  comparison.configureB({mode:'single',fresnelCutoff:.08});assert.deepEqual(calls[1],{mode:'single',fresnelCutoff:.08});
  comparison.select('A');assert.equal(calls[2].mode,'full');
  comparison.select('B');assert.equal(calls[3].mode,'single');
  assert.throws(()=>comparison.select('C'));
});
test('budget branch controls actual reflection queries while transmission keeps its existing query path',()=>{
  const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('fn integrateWorldReflectionQuadrature('),source.indexOf('fn weightedDepth('));
  assert.match(body,/reflectionBudgetControls/,'ray budgets must affect the actual optical shader');
  assert.match(body,/fresnel <=/);
  assert.match(body,/sceneQueries/);
  const transmission=source.slice(source.indexOf('fn integrateTransmissionQuadrature('),source.indexOf('fn reflectionSampleFromOpticalQuery('));
  assert.doesNotMatch(transmission,/reflectionBudget/,'reflection approximation must not silently change transmitted scene radiance');
});

test('a new water runtime resets selection without losing B settings or applying policy',async()=>{
  const m=await load(),calls=[];const c=m.createReflectionComparison({apply:p=>{calls.push(p);return p;}});
  c.configureB({mode:'single'});c.select('B');
  assert.equal(typeof c.reset,'function');c.reset();
  assert.equal(c.read().selected,'A');assert.equal(c.read().candidate.mode,'single');
  assert.equal(c.read().effective,null);assert.equal(calls.length,1);
});
test('an apply failure does not claim the failed choice as effective',async()=>{
  const m=await load();const c=m.createReflectionComparison({apply:()=>{throw Error('render failed');}});
  assert.throws(()=>c.select('B'),/render failed/);
  assert.equal(c.read().selected,'A');assert.equal(c.read().effective,null);
});
test('effective reflection policy requires an actually completed shaded refraction frame',async()=>{
 const m=await load();assert.equal(typeof m.reflectionBudgetExecution,'function');
 const encoded={mode:'single',fresnelCutoff:.04};
 for(const rendererMode of ['sphere_debug','screen_space_surface'])assert.equal(m.reflectionBudgetExecution({rendererMode,opticalDebugMode:'shaded',frameId:8},encoded).effective,null);
 assert.equal(m.reflectionBudgetExecution({rendererMode:'screen_space_refraction',opticalDebugMode:'normal',frameId:8},encoded).effective,null);
 assert.equal(m.reflectionBudgetExecution({rendererMode:'screen_space_refraction',opticalDebugMode:'shaded',frameId:0},encoded).effective,null);
 const actual=m.reflectionBudgetExecution({rendererMode:'screen_space_refraction',opticalDebugMode:'shaded',frameId:8},encoded);
 assert.deepEqual(actual.effective,encoded);assert.equal(actual.rendererMode,'screen_space_refraction');assert.equal(actual.status,'executed_shaded');
});
