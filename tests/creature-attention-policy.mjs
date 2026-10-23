// kaminos-test: node
import assert from 'node:assert/strict';
import {createAttentionPolicy} from '../experiments/creature-motion/attention-policy.mjs';

function makeObservation(overrides = {}) {
  return {
    id: 'a',
    point: [0, 0, 0],
    score: 1,
    reason: 'test',
    ...overrides,
  };
}

// Selection: a single positive-score observation is acquired as focus.
{
  const policy = createAttentionPolicy();
  const state = policy.update({time: 0, observations: [makeObservation()]});
  assert.equal(state.focus?.id, 'a');
  assert.deepEqual(state.focus.point, [0, 0, 0]);
  assert.equal(state.focus.reason, 'test');
  assert.equal(state.focus.remembered, false);
  assert.equal(state.focus.acquiredAt, 0);
  assert.equal(state.focus.lastObservedAt, 0);
}

// Zero-score observations do not independently attract focus.
{
  const policy = createAttentionPolicy();
  const state = policy.update({time: 0, observations: [makeObservation({score: 0})]});
  assert.equal(state.focus, null);
}

// No observations at all leaves focus null.
{
  const policy = createAttentionPolicy();
  const state = policy.update({time: 0, observations: []});
  assert.equal(state.focus, null);
}

// Stable holding: within the dwell window, a merely stronger contender does not steal focus.
{
  const policy = createAttentionPolicy({minDwellSeconds: 1, switchMargin: 0});
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const state = policy.update({
    time: 0.5,
    observations: [
      makeObservation({id: 'a', score: 1}),
      makeObservation({id: 'b', score: 5}),
    ],
  });
  assert.equal(state.focus.id, 'a');
}

// Stronger-source switch: after the dwell boundary, a sufficiently stronger contender replaces focus.
{
  const policy = createAttentionPolicy({minDwellSeconds: 1, switchMargin: 0.5});
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const held = policy.update({
    time: 1,
    observations: [
      makeObservation({id: 'a', score: 1}),
      makeObservation({id: 'b', score: 1.2}),
    ],
  });
  assert.equal(held.focus.id, 'a', 'margin not cleared yet, should hold');
  const switched = policy.update({
    time: 1,
    observations: [
      makeObservation({id: 'a', score: 1}),
      makeObservation({id: 'b', score: 2}),
    ],
  });
  assert.equal(switched.focus.id, 'b');
  assert.equal(switched.focus.acquiredAt, 1);
}

// Deterministic ties: equal top score picks the same winner regardless of list order.
{
  const obsForward = [
    makeObservation({id: 'x', score: 3}),
    makeObservation({id: 'y', score: 3}),
  ];
  const obsReverse = [
    makeObservation({id: 'y', score: 3}),
    makeObservation({id: 'x', score: 3}),
  ];
  const policyA = createAttentionPolicy();
  const stateA = policyA.update({time: 0, observations: obsForward});
  const policyB = createAttentionPolicy();
  const stateB = policyB.update({time: 0, observations: obsReverse});
  assert.equal(stateA.focus.id, stateB.focus.id);
  assert.equal(stateA.focus.id, 'x');
}

// Zero dwell and zero margin: a stronger contender can switch focus on the very next update.
{
  const policy = createAttentionPolicy({minDwellSeconds: 0, switchMargin: 0});
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const state = policy.update({
    time: 0,
    observations: [
      makeObservation({id: 'a', score: 1}),
      makeObservation({id: 'b', score: 1.0001}),
    ],
  });
  assert.equal(state.focus.id, 'b');
}

// Zero memory: once a source disappears, focus releases immediately rather than lingering.
{
  const policy = createAttentionPolicy({defaultMemorySeconds: 0});
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const state = policy.update({time: 0, observations: []});
  assert.equal(state.focus, null);
}

// Last-observed-point retention: an absent source keeps its last point while remembered.
{
  const policy = createAttentionPolicy({defaultMemorySeconds: 5});
  policy.update({
    time: 0,
    observations: [makeObservation({id: 'a', score: 1, point: [1, 2, 3]})],
  });
  const state = policy.update({time: 1, observations: []});
  assert.equal(state.focus.id, 'a');
  assert.equal(state.focus.remembered, true);
  assert.deepEqual(state.focus.point, [1, 2, 3]);
  assert.equal(state.focus.lastObservedAt, 0);
}

// Expiry: a remembered focus releases once its memory lifetime elapses.
{
  const policy = createAttentionPolicy({defaultMemorySeconds: 2});
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  policy.update({time: 1, observations: []});
  const state = policy.update({time: 2.5, observations: []});
  assert.equal(state.focus, null);
}

// Per-observation memorySeconds overrides the default.
{
  const policy = createAttentionPolicy({defaultMemorySeconds: 100});
  policy.update({
    time: 0,
    observations: [makeObservation({id: 'a', score: 1, memorySeconds: 1})],
  });
  policy.update({time: 0.5, observations: []});
  const state = policy.update({time: 1.5, observations: []});
  assert.equal(state.focus, null);
}

// Invalidation: explicitly invalidating the current focus releases it promptly, without waiting on dwell.
{
  const policy = createAttentionPolicy({minDwellSeconds: 10, defaultMemorySeconds: 100});
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const state = policy.update({time: 0.1, observations: [], invalidatedIds: ['a']});
  assert.equal(state.focus, null);
}

// No-candidate release: when nothing is eligible and memory is exhausted, focus is null, not stale.
{
  const policy = createAttentionPolicy({defaultMemorySeconds: 0});
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const state = policy.update({time: 10, observations: []});
  assert.equal(state.focus, null);
}

// Exact snapshot/replay: restoring a snapshot reproduces subsequent behavior identically.
{
  const policyA = createAttentionPolicy({minDwellSeconds: 1, switchMargin: 0.2, defaultMemorySeconds: 3});
  policyA.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  policyA.update({time: 0.4, observations: [makeObservation({id: 'a', score: 1})]});
  const snap = policyA.snapshot();

  const policyB = createAttentionPolicy({minDwellSeconds: 1, switchMargin: 0.2, defaultMemorySeconds: 3});
  policyB.restore(snap);

  const nextObservations = [
    makeObservation({id: 'a', score: 1}),
    makeObservation({id: 'b', score: 5}),
  ];
  const stateA = policyA.update({time: 2, observations: nextObservations.map((o) => ({...o}))});
  const stateB = policyB.update({time: 2, observations: nextObservations.map((o) => ({...o}))});
  assert.deepEqual(stateA, stateB);
}

// Actor isolation: two independent policy instances do not share state.
{
  const policyA = createAttentionPolicy();
  const policyB = createAttentionPolicy();
  policyA.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const stateB = policyB.update({time: 0, observations: []});
  assert.equal(stateB.focus, null);
  assert.equal(policyA.read().focus.id, 'a');
}

// Non-aliasing: returned state/snapshot objects do not alias mutable internal state,
// and mutating an input observation after the call does not retroactively change stored state.
{
  const policy = createAttentionPolicy();
  const obs = makeObservation({id: 'a', score: 1, point: [1, 1, 1]});
  const state = policy.update({time: 0, observations: [obs]});
  obs.point[0] = 999;
  state.focus.point[0] = -1;
  assert.equal(policy.read().focus.point[0], 1, 'internal state must not alias the input observation or a returned record');

  const snap = policy.snapshot();
  JSON.stringify(snap);
  const policyClone = createAttentionPolicy();
  policyClone.restore(snap);
  assert.equal(policyClone.read().focus.point[0], 1);
  policyClone.update({time: 0, observations: [makeObservation({id: 'a', score: 1, point: [7, 7, 7]})]});
  assert.equal(policy.read().focus.point[0], 1, 'snapshot/restore on a clone must not alias the original policy state');

  const readA = policy.read();
  const readB = policy.read();
  assert.notEqual(readA, readB, 'read() must return fresh objects, not the same reference');
}

// Invalid-data transactionality: malformed input is rejected before any state change.
{
  const policy = createAttentionPolicy();
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const before = policy.snapshot();

  assert.throws(() => policy.update({time: 1, observations: [makeObservation({id: ''})]}));
  assert.throws(() => policy.update({time: 1, observations: [makeObservation({score: -1})]}));
  assert.throws(() => policy.update({time: 1, observations: [makeObservation({score: Number.NaN})]}));
  assert.throws(() => policy.update({time: 1, observations: [makeObservation({point: [0, 0]})]}));
  assert.throws(() => policy.update({time: 1, observations: [makeObservation({point: [0, 0, Number.POSITIVE_INFINITY]})]}));
  assert.throws(() => policy.update({
    time: 1,
    observations: [makeObservation({id: 'dup'}), makeObservation({id: 'dup'})],
  }));
  assert.throws(() => policy.update({time: Number.NaN, observations: []}));

  const after = policy.snapshot();
  assert.deepEqual(before, after, 'a rejected update must not mutate state');
}

// Backward time is unsupported outside the explicit snapshot/restore rewind path.
{
  const policy = createAttentionPolicy();
  policy.update({time: 5, observations: [makeObservation({id: 'a', score: 1})]});
  assert.throws(() => policy.update({time: 4, observations: [makeObservation({id: 'a', score: 1})]}));
}

// restore() is the explicit rewind path: it accepts a snapshot whose time precedes current state.
{
  const policy = createAttentionPolicy();
  policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  const early = policy.snapshot();
  policy.update({time: 10, observations: [makeObservation({id: 'a', score: 1})]});
  policy.restore(early);
  const state = policy.update({time: 0.1, observations: [makeObservation({id: 'a', score: 1})]});
  assert.equal(state.focus.id, 'a');
}

// reset() clears focus and history, and permits restarting the clock.
{
  const policy = createAttentionPolicy();
  policy.update({time: 10, observations: [makeObservation({id: 'a', score: 1})]});
  policy.reset();
  assert.equal(policy.read().focus, null);
  const state = policy.update({time: 0, observations: [makeObservation({id: 'a', score: 1})]});
  assert.equal(state.focus.id, 'a');
}

// More observations than a tempting arbitrary population cap: every supplied observation is considered.
{
  const policy = createAttentionPolicy();
  const count = 5000;
  const observations = [];
  for (let i = 0; i < count; i += 1) {
    observations.push(makeObservation({id: `obs-${i}`, score: i === count - 1 ? 1000 : 1}));
  }
  const state = policy.update({time: 0, observations});
  assert.equal(state.focus.id, `obs-${count - 1}`);
}

console.log('attention policy: selection, dwell, switching, ties, memory, expiry, invalidation, snapshot/replay, isolation, non-aliasing, and transactional validation all hold');

{
 const p=createAttentionPolicy({defaultMemorySeconds:2});
 p.update({time:0,observations:[makeObservation({point:[1,2,3],velocity:[0,2,0]})]});
 const snap=p.snapshot(),clone=createAttentionPolicy();clone.restore(snap);
 const gap=p.update({time:.5,observations:[]}).focus;
 assert.ok(gap.point[1]>2&&gap.point[1]<3,'prediction continues but slows');
 assert.equal(gap.confidence,.75);
 assert.deepEqual(clone.update({time:.5,observations:[]}).focus,gap,'predicted track replays exactly');
 const before=p.snapshot();assert.throws(()=>p.update({time:1,observations:[makeObservation({velocity:[NaN,0,0]})]}));assert.deepEqual(p.snapshot(),before);
 assert.equal(p.update({time:2,observations:[]}).focus,null);
}
