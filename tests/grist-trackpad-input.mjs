import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from '../lib/three.webgpu.js';
import {createGripPressure, installGristTrackpadGrip} from '../experiments/grist-trackpad-input.mjs';

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

function gestureFixture({admit = () => true, obstruct = false} = {}) {
  const document = new EventTarget(), window = new EventTarget(), canvas = new EventTarget();
  const captured = new Set();
  document.defaultView = window;
  window.MouseEvent = {};
  Object.assign(canvas, {
    ownerDocument:document, style:{},
    getBoundingClientRect:() => ({left:0, top:0, width:100, height:100}),
    setPointerCapture:id => captured.add(id),
    hasPointerCapture:id => captured.has(id),
    releasePointerCapture:id => captured.delete(id),
  });
  const camera = new THREE.PerspectiveCamera(35, 1);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const grip = mesh(), tray = mesh();
  tray.position.z = obstruct ? 2 : -2;
  const gesture = installGristTrackpadGrip({
    canvas, camera, grip, admit, occluders:[tray], move() {}, setGain() {}, changed() {},
  });
  return {
    press() {
      const event = new Event('pointerdown', {cancelable:true});
      for (const [name, value] of Object.entries({
        target:canvas, pointerId:1, isPrimary:true, pointerType:'mouse', button:0, clientX:50, clientY:50,
      })) Object.defineProperty(event, name, {value});
      document.dispatchEvent(event);
      return {captured:captured.has(1), canceled:event.defaultPrevented};
    },
    dispose() {
      gesture.dispose();
      for (const object of [grip, tray]) { object.geometry.dispose(); object.material.dispose(); }
    },
  };
}

test('an existing viewport interaction gets the press before the grip', t => {
  const fixture = gestureFixture({admit:() => false});
  t.after(fixture.dispose);
  assert.deepEqual(fixture.press(), {captured:false, canceled:false});
});

test('only a visible grip claims the press and preserves compatibility mouse events', t => {
  const hidden = gestureFixture({obstruct:true}), visible = gestureFixture();
  t.after(hidden.dispose);
  t.after(visible.dispose);
  assert.deepEqual(hidden.press(), {captured:false, canceled:false});
  assert.deepEqual(visible.press(), {captured:true, canceled:false});
});
