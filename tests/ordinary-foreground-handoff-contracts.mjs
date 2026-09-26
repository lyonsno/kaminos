import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const wrapper = core.slice(core.indexOf('  let foregroundRequester = null;'), core.indexOf('  function renderOrdinaryFrame('));
const scheduled = [];
const device = {queue: {submit() {}}};
const state = {active: true, frameCount: 0, simStepCount: 0};
let completeA;
const make = new Function('state', 'device', 'requestAnimationFrame', 'cancelAnimationFrame', 'renderOrdinaryFrame', 'canvas', 'emitStatus', 'performance', `
let raf = 0, selectiveHeadLiveCapturePaused = false;
const productFrameOwner = 'prototype';
const boundarySplatRequested = () => false, browserResidualCanApply = () => false;
${wrapper}
return {render, setForegroundOpportunityRequester, pauseForegroundAdmission, resumeForegroundAdmission};`);
const api = make(state, device, fn => (scheduled.push(fn), scheduled.length), () => {}, (now, service) => {
  service.submit(['ordinary-frame']);
  return {status: 'submitted', renderer: 'ordinary-volume', frameCount: ++state.frameCount, simStepCount: ++state.simStepCount};
}, {classList: {remove() {}}}, () => {}, {now: () => 1});

api.setForegroundOpportunityRequester(input => ({
  completion: new Promise(resolve => { completeA = () => resolve({status: 'completed', result: input.run({device, queue: device.queue, submit() {}})}); }),
}));
api.render(1);
const draining = api.pauseForegroundAdmission();
await Promise.resolve();
assert.equal(typeof completeA, 'function', 'already admitted frame must still reach its requester');
let drained = false;
draining.then(() => { drained = true; });
assert.equal(drained, false, 'pause cannot claim drain before completion');
completeA();
await draining;
assert.equal(state.frameCount, 1);
assert.equal(scheduled.length, 0, 'pause cannot admit a successor frame');
api.setForegroundOpportunityRequester(input => ({completion: Promise.resolve({status: 'completed', result: input.run({device, queue: device.queue, submit() {}})})}));
api.resumeForegroundAdmission();
assert.equal(scheduled.length, 1, 'resume must admit the rebound requester');
scheduled.pop()(2);
await new Promise(resolve => setImmediate(resolve));
assert.equal(state.frameCount, 2);
assert.equal(state.error, undefined);
console.log('ordinary foreground pause/drain/rebind/resume contract passed');
