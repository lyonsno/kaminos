import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createGripPressure} from '../experiments/grist-trackpad-input.mjs';

test('plain drag holds at the existing strength and force samples only affect an active drag', () => {
  const pressure = createGripPressure();
  assert.equal(pressure.sample(1.8), false);
  pressure.start();
  assert.deepEqual(pressure.read(), {active:true, source:'standard', normalized:null, gain:1});
  assert.equal(pressure.sample(NaN), false);
  assert.equal(pressure.sample(0), false);
  assert.equal(pressure.sample(1), true);
  assert.deepEqual(pressure.read(), {active:true, source:'webkit-force', normalized:0, gain:.5});
  pressure.sample(1.5);
  assert.equal(pressure.read().gain, .875);
  pressure.sample(2.7);
  assert.equal(pressure.read().gain, 1.25);
  pressure.end();
  assert.deepEqual(pressure.read(), {active:false, source:'standard', normalized:null, gain:1});
});

test('the pressure ramp uses WebKit mouse-down and force-click thresholds', () => {
  const pressure = createGripPressure({down:2, forceDown:4});
  pressure.start();
  pressure.sample(3);
  assert.equal(pressure.read().normalized, .5);
});
