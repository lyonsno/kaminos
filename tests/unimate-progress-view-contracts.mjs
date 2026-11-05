// kaminos-test: node
import assert from 'node:assert/strict';
import { createMotionProgress } from '../models/unimate/unimate-progress-view.js';
import { dopri5Solve } from '../models/unimate/unimate-dopri5.js';

const elements = new Map();
const get = id => {
  if (!elements.has(id)) elements.set(id, { textContent: '', hidden: true, value: null,
    removeAttribute() { this.value = null; } });
  return elements.get(id);
};
const original = { performance, setInterval, clearInterval };
let now = 0, label, tick;
globalThis.performance = { now: () => now };
globalThis.setInterval = fn => { tick = fn; return 1; };
globalThis.clearInterval = () => { tick = null; };
try {
  const progress = createMotionProgress(get, text => { label = text; });
  progress.start('Loading model');
  progress.bytes(20, 100);
  assert.equal(get('bar').value, .2);
  progress.bytes(25, null);
  assert.equal(get('bar').value, null, 'unknown total must not reuse a byte denominator');
  now = 2500; tick();
  assert.equal(get('elapsed').textContent, '2.5 s elapsed');
  progress.finish('Model loaded');
  assert.equal(tick, null);
  progress.start('Preparing generation', [0, 1]);
  assert.equal(get('bar').value, null);
  progress.evaluation({ evaluations: 5, t: .9 });
  assert.equal(get('bar').value, null, 'trial evaluation time must not advance accepted solver progress');
  progress.step({ t0: 0, dt: .3, accepted: true });
  assert.equal(get('bar').value, .3);
  progress.step({ t0: .3, dt: .5, accepted: false });
  assert.equal(get('bar').value, .3, 'rejected steps must not advance the bar');
  progress.control('Generation paused');
  progress.evaluation({ evaluations: 6, t: .8 });
  assert.equal(label, 'Generation paused');
  assert.equal(get('bar').hidden, true);
  progress.control(null);
  assert.equal(get('bar').value, .3);
  progress.finish('Stopped');
  assert.equal(get('bar').hidden, true);
  assert.equal(tick, null);
  progress.start('Preparing generation', [0, 1]);
  assert.equal(get('evaluations').textContent, '--');
  // The real solver's accepted-step callback supplies the UI's denominator semantics.
  await dopri5Solve({ y0: new Float32Array([0]), drift: async () => new Float32Array([1]),
    outputTimes: [0, .5, 1], onStep: progress.step });
  assert.equal(get('bar').value, 1);
  assert.equal(get('progress-label').textContent, 'Solver interval');
  now = 5000; progress.finish('Motion complete');
  assert.equal(get('elapsed').textContent, '2.5 s elapsed');
  assert.equal(get('bar').value, 1);
  assert.equal(tick, null);
} finally { Object.assign(globalThis, original); }
console.log('UniMate progress: real accepted solver steps, uncertainty, controls and timer lifetime passed');
