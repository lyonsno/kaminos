import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(core, /function setForegroundOpportunityRequester\(/, 'ordinary renderer must expose its own frame-service connection');
const wrapper = core.slice(core.indexOf('  function setForegroundOpportunityRequester('), core.indexOf('  function renderOrdinaryFrame('));
let scheduled = [], submitted = [], executions = 0;
let serviceInput, fail = false;
const device = {queue: {submit() {throw new Error('private submit');}}};
const state = {active: true, frameCount: 0, simStepCount: 0};
const make = new Function('state','device','requestAnimationFrame','cancelAnimationFrame','renderOrdinaryFrame','canvas','emitStatus','performance', `
let foregroundRequester = null, foregroundPending = null, foregroundSequence = 0, raf = 0;
let selectiveHeadLiveCapturePaused = false;
const productFrameOwner = 'prototype';
const boundarySplatRequested = () => false, browserResidualCanApply = () => false;
${wrapper}
return {render, setForegroundOpportunityRequester};`);
const api = make(state, device, fn => (scheduled.push(fn), scheduled.length), () => {}, (now, service) => {
  executions++;
  if (fail) throw new Error('renderer failed');
  service.submit(['actual-frame']);
  return {status:'submitted', frameCount: ++state.frameCount, simStepCount: ++state.simStepCount, renderer:'ordinary', atMs:now};
}, {classList:{remove(){}}}, () => {}, {now:()=>10});
api.setForegroundOpportunityRequester(input => {
  serviceInput = input;
  return {completion: Promise.resolve().then(() => input.run({device, queue:device.queue, submit: commands => submitted.push(commands)})).then(result=>({status:'completed',result}))};
});
api.render(1);
api.render(2); // one pending animation frame, not a second private submission
assert.equal(executions, 0, 'no renderer work before service');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(executions, 1);
assert.deepEqual(submitted, [['actual-frame']]);
assert.equal(scheduled.length, 1);
assert.equal(state.ordinaryForeground.completedFrames, 1);
assert.equal(state.ordinaryForeground.lastReceipt.result.frameCount, 1);
assert.throws(()=>serviceInput.run({device:{}, queue:device.queue, submit(){}}), /device/);
fail = true;
api.render(3);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(state.active, false);
assert.match(state.error, /renderer failed/);
assert.equal(scheduled.length, 1, 'failed frame cannot silently reschedule');
const body = core.slice(core.indexOf('  function renderOrdinaryFrame('), core.indexOf('  function pumpLookLabFrozenFrame('));
assert.match(body, /foregroundService\.submit\(\[encoder\.finish\(\)\]/);
assert.match(body, /encodeFireIrradianceLightField\(encoder\)/);
assert.match(body, /updateUniforms\(now\)/);
assert.match(body, /if \(foregroundService\) throw err/);
assert.match(body, /if \(!foregroundService &&/);
console.log('Ordinary frame service ordering, exact device, single pending frame and failure contracts passed');
