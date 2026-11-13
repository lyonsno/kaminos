// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as jax from '@jax-js/jax';
import {q4Fixture,q4Reference} from './q4-reference.mjs';
import {makeTrainingRun,validateRun,validateCheckpoint,runIdentity,createQ4Trainer} from './training.mjs';

test('AdamW continuation preserves optimizer, RNG, sample order and values',async()=>{
  await jax.init('cpu');jax.defaultDevice('cpu');
  const run=await makeTrainingRun({fixtures:[q4Fixture(),q4Fixture()],updates:5,seed:17});
  run.fixtures[1].target=run.fixtures[1].target.map(x=>x+0.01);
  const whole=await createQ4Trainer(jax,run,'cpu');
  for(let i=0;i<5;i++)await whole.step();
  const expected=await whole.snapshot();await whole.dispose();
  const first=await createQ4Trainer(jax,run,'cpu');
  for(let i=0;i<2;i++)await first.step();
  const saved=await first.snapshot();await first.dispose();
  const resumed=await createQ4Trainer(jax,run,'cpu',saved);
  for(let i=0;i<3;i++)await resumed.step();
  const actual=await resumed.snapshot();await resumed.dispose();
  assert.deepEqual(actual,expected);
  assert.equal(actual.update,5);assert.equal(actual.cursor,1);assert.equal(actual.epoch,2);
  assert.ok(actual.order.length===2);assert.notEqual(actual.rng,17);
});

test('first AdamW update agrees with independently calculated scalar gradient',async()=>{
  const f=q4Fixture(), run=await makeTrainingRun({fixtures:[f],updates:1,seed:3});
  const t=await createQ4Trainer(jax,run,'cpu');const before=await t.snapshot();
  await t.step();const after=await t.snapshot();await t.dispose();
  const g=q4Reference(f).grad,{learningRate:lr,epsilon,weightDecay}=run.optimizer;
  for(const name of ['a','b'])for(let i=0;i<before.params[name].length;i++){
    const p=before.params[name][i],v=g[name][i];
    const expected=p*(1-lr*weightDecay)-lr*v/(Math.abs(v)+epsilon);
    assert.ok(Math.abs(after.params[name][i]-expected)<3e-6);
    assert.ok(Math.abs(after.m[name][i]-(1-run.optimizer.beta1)*v)<1e-7);
  }
});

test('checkpoint rejects changed data, configuration, incomplete state and nonfinite tensors',async()=>{
  const run=await makeTrainingRun({fixtures:[q4Fixture()],updates:2});
  const t=await createQ4Trainer(jax,run,'cpu');const state=await t.snapshot();await t.dispose();
  await validateCheckpoint(run,state);
  const changed=structuredClone(run);changed.fixtures[0].base.packed[0]+=1;
  await assert.rejects(validateCheckpoint(changed,state),/identity/);
  const other=structuredClone(run);other.optimizer.learningRate*=2;
  await assert.rejects(validateCheckpoint(other,state),/identity/);
  for(const modify of [s=>delete s.m,s=>s.params.a.pop(),s=>s.params.b[0]=NaN,s=>s.order=[1],s=>s.cursor=2]){
    const broken=structuredClone(state);modify(broken);await assert.rejects(validateCheckpoint(run,broken));
  }
  assert.equal(await runIdentity(run),state.runIdentity);
});

test('manifest rejects unsupported route, hidden shape changes and output-data corruption',async()=>{
  const run=await makeTrainingRun({fixtures:[q4Fixture()],updates:1});
  assert.doesNotThrow(()=>validateRun(run));
  for(const modify of [r=>r.backend='wasm',r=>r.updates=0,r=>r.fixtures[0].base.packed.pop(),r=>r.fixtures[0].dims.alpha=NaN,r=>r.optimizer.beta2=1]){
    const bad=structuredClone(run);modify(bad);assert.throws(()=>validateRun(bad));
  }
});
