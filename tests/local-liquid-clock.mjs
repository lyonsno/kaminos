import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createLiquidClock } from '../local-liquid-clock.mjs';

test('completion waits for the queue and held views never advance', async () => {
  let release, steps=0;
  const clock=createLiquidClock({runId:'test',step:()=>steps++,drain:()=>new Promise(resolve=>{release=resolve;})});
  clock.tick();clock.tick();
  const hold=clock.hold();
  assert.equal(clock.read().completedSteps,0);assert.equal(clock.read().submittedSteps,2);
  clock.tick();assert.equal(steps,2);
  release();await hold;assert.equal(clock.read().completedSteps,2);
  const advance=clock.advanceTo(.1);assert.equal(steps,6);assert.equal(clock.read().completedSteps,2);
  assert.throws(()=>clock.setPaused(false),/advancing/);
  release();await advance;assert.equal(clock.read().simulationSeconds,.1);
  for(let i=0;i<12;i++)clock.tick();assert.equal(steps,6);
  await assert.rejects(clock.advanceTo(0),/precedes/);
  await assert.rejects(clock.advanceTo(.101),/align/);
});
test('failed drain preserves last trustworthy completion and rejects further observations', async () => {
  const clock=createLiquidClock({runId:'test',step:()=>{},drain:async()=>{throw Error('device lost');}});
  clock.setPaused(true);
  await assert.rejects(clock.advanceTo(1),/device lost/);
  assert.equal(clock.read().completedSteps,0);assert.equal(clock.read().submittedSteps,60);
  await assert.rejects(clock.hold(),/device lost/);
});
test('replaced runtime cannot certify completion',async()=>{
  let current=true;
  const clock=createLiquidClock({runId:'old',step:()=>{},drain:async()=>{current=false;},assertCurrent:()=>{if(!current)throw Error('replaced');}});
  await assert.rejects(clock.hold(),/replaced/);assert.equal(clock.read().completedSteps,0);
});

test('host state exposes completed simulation time separately from rendered frames', () => {
  const source = fs.readFileSync(new URL('../local-liquid-host.mjs', import.meta.url), 'utf8');
  const expression = source.slice(source.indexOf('state:()=>(') + 'state:()=>'.length, source.indexOf(',\n    dispose()'));
  const state = vm.runInNewContext(expression, {
    ROUTE: 'actual-host', frameCount: 29, failure: null, paused: true, authored: {}, lastFrame: {},
    structuredClone, solver: { getDebugState: () => ({}) }, sourceGeneration: 2,
    clock: { read: () => ({ completedSteps: 12, simulationSeconds: .2 }) },
  });
  assert.equal(state.clock?.completedSteps, 12, 'held render frames must retain completed solver steps');
  assert.equal(state.frameCount, 29);
});
