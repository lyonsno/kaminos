// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Quaternion, Vector3} from '../lib/three.core.js';
import {createHandProposal} from '../stockroom-hand-proposal.mjs';

const initial = {position: [0, 1, 0], rotation: [0, 0, 0, 1], width: .6};
function hand({side = 'left', eligible = true, closed = false, x = 0, yaw = 0} = {}) {
  return {side, eligible, gap: closed ? .2 : .9, point: new Vector3(x, 1, 0),
    frame: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)};
}

test('hand initiates, pointer refines the parked proposal, and hand regrips without a jump', () => {
  const p = createHandProposal(initial);
  p.observe([hand({closed: true})]);
  assert.equal(p.read().mode, 'parked', 'arrival already closed cannot take up the piece');
  p.observe([hand()]);
  assert.equal(p.read().armed, 'left');
  p.observe([hand({closed: true})]);
  assert.equal(p.read().mode, 'held');
  p.observe([hand({closed: true, eligible: false, x: 2, yaw: .5})]);
  assert.equal(p.read().pose.position[0], 2);
  assert.ok(p.read().pose.rotation[1] > .2);
  p.observe([hand({x: 2})]);
  assert.equal(p.read().mode, 'parked');
  p.beginPointer();
  p.refine({width: .85});
  p.endPointer();
  const refined = p.read().pose;
  p.observe([hand({x: 4, yaw: -.8})]);
  p.observe([hand({closed: true, x: 4, yaw: -.8})]);
  assert.deepEqual(p.read().pose, refined);
  p.observe([hand({closed: true, x: 5, yaw: -.8})]);
  assert.deepEqual(p.read().pose.position, [3, 1, 0]);
  assert.equal(p.read().pose.width, .85);
});

test('loss requires a fresh open/close, navigation rebases, and another hand cannot steal a grasp', () => {
  const p = createHandProposal(initial);
  p.observe([hand()]);
  p.observe([hand({closed: true})]);
  p.observe([hand({side: 'right', closed: true, x: 90}), hand({closed: true, x: 1})]);
  p.suspend();
  p.observe([hand({closed: true, x: 10})]);
  assert.deepEqual(p.read().pose.position, [1, 1, 0]);
  p.observe([hand({closed: true, x: 11})]);
  assert.deepEqual(p.read().pose.position, [2, 1, 0]);
  p.observe([]);
  assert.equal(p.read().mode, 'parked');
  p.observe([hand({closed: true, x: 99})]);
  assert.equal(p.read().mode, 'parked');
  assert.deepEqual(p.read().pose.position, [2, 1, 0]);
});

test('the pointer deliberately takes over and can accept or back out', () => {
  const p = createHandProposal(initial);
  p.observe([hand()]);
  p.observe([hand({closed: true})]);
  p.beginPointer();
  p.refine({position: [2, 1, 1], width: .9});
  p.observe([hand({closed: true, x: 30})]);
  assert.equal(p.read().mode, 'pointer');
  assert.deepEqual(p.read().pose.position, [2, 1, 1]);
  p.endPointer();
  p.accept();
  p.beginPointer();
  p.refine({width: .4});
  p.endPointer();
  p.back();
  assert.equal(p.read().pose.width, .9);
  p.back();
  assert.deepEqual(p.read().pose, initial);
});

test('nomination is explicit and is consumed by the next grasp', () => {
  const p = createHandProposal(initial);
  p.observe([hand({eligible: false})]);
  p.observe([hand({eligible: false, closed: true})]);
  assert.equal(p.read().mode, 'parked');
  p.nominate();
  p.observe([hand({eligible: false})]);
  p.observe([hand({eligible: false, closed: true})]);
  assert.equal(p.read().mode, 'held');
  assert.equal(p.read().nominated, false);
});
