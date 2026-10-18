// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRetainedSetup} from '../retained-setup.mjs';

const project = ({baseline, observed, choices}) => ({
  document: {...baseline, rate: choices.rate ? observed.rate : baseline.rate},
  groups: [{id: 'rate', label: 'Rate', checked: true}],
});
test('keep uses the captured observation, preserves unrelated setup and leaves live state alone', () => {
  const initial = {rate: 1, placement: [0, 0, 0]}, live = {rate: 2, placement: [3, 0, 0]};
  const setup = createRetainedSetup({document: initial});
  const proposal = setup.prepare({observe: () => live, project});
  live.rate = 3;
  const preview = proposal.preview({rate: true});
  assert.equal(preview.document.rate, 2);
  preview.document.placement[0] = 99;
  proposal.commit({rate: true});
  assert.deepEqual(setup.read().document, {rate: 2, placement: [0, 0, 0]});
  assert.equal(live.rate, 3);
  assert.equal(initial.rate, 1);
  setup.undo(); assert.equal(setup.read().document.rate, 1);
  setup.redo(); assert.equal(setup.read().document.rate, 2);
});
test('a changed baseline invalidates an open proposal including after undo', () => {
  const setup = createRetainedSetup({document: {rate: 1}});
  const a = setup.prepare({observe: () => ({rate: 2}), project});
  const b = setup.prepare({observe: () => ({rate: 3}), project});
  b.commit({rate: true}); setup.undo();
  assert.throws(() => a.commit({rate: true}), /Setup changed/);
  assert.equal(setup.read().document.rate, 1);
});
test('validation failure is atomic and an adapter cannot mutate retained state', () => {
  const setup = createRetainedSetup({document: {rate: 1}, validate: d => {
    if (!Number.isFinite(d.rate) || d.rate <= 0) throw Error('Invalid rate');
  }});
  const p = setup.prepare({observe: () => ({rate: -1}), project: args => {
    args.baseline.rate = 999; return project(args);
  }});
  assert.throws(() => p.commit({rate: true}), /Invalid rate/);
  assert.deepEqual(setup.read(), {revision: 0, document: {rate: 1}, undoCount: 0, redoCount: 0});
});
test('replacing a setup validates, isolates inputs and clears obsolete history', () => {
  const setup = createRetainedSetup({document: {rate: 1}});
  const p = setup.prepare({observe: () => ({rate: 2}), project});
  p.commit({rate: true}); const next = {rate: 4}; setup.replace(next); next.rate = 9;
  assert.equal(setup.read().document.rate, 4);
  assert.equal(setup.undo(), false);
  assert.throws(() => p.preview({rate: true}), /Setup changed/);
});
