import assert from 'node:assert/strict';
import test from 'node:test';
import { experiment } from '../experiment-work.mjs';

test('standalone runtime owns camera and observation without workbench globals', async () => {
  let reads = 0, settled = 0, checked = 0;
  const state = { camera: { position: [1, 2, 3] }, run: 'stone-7', step: 30, seconds: .5 };
  const runtime = {
    camera: async view => ({ ...view, effective: 'stone-camera' }),
    settle: async () => { settled++; },
    read: async () => { reads++; return structuredClone(state); },
    assertStable: (a, b) => { checked++; assert.deepEqual(a, b); },
  };
  const work = experiment({ runtime, page: { evaluate: async () => ({ effective: 'workbench-fallback' }) },
    retain: async ({ observe, verify }) => { const effective = await observe(); await verify(); return { effective, retained: true }; } });
  assert.deepEqual(await work.camera({ position: [1, 2, 3] }), { position: [1, 2, 3], effective: 'stone-camera' });
  const result = await work.observe('held-stone');
  assert.deepEqual(result.observed, state);
  assert.equal(reads, 2); assert.equal(settled, 1); assert.equal(checked, 1);
  assert.equal(work.runtime, runtime);
});

test('runtime replacement during capture fails instead of returning a valid observation', async () => {
  let run = 'first';
  const runtime = { settle: async () => {}, read: async () => ({ run }), camera: async () => {},
    assertStable: (a, b) => assert.equal(b.run, a.run, 'Replaced runtime') };
  const work = experiment({ runtime, retain: async ({ observe, verify }) => { await observe(); run = 'second'; await verify(); return {}; } });
  await assert.rejects(work.observe('reset'), /Replaced runtime/);
});

test('missing runtime consistency check fails before capture', () => {
  assert.throws(() => experiment({ runtime: { read: async () => ({}) }, retain: async () => {} }), /runtime.*settle|runtime.*assertStable/);
});

test('stamp mode brackets acquisition and capture with one full state read', async () => {
  const events = [];
  const runtime = { settle: async () => {}, camera: async () => {},
    read: async () => { events.push('payload'); return { vertices: [1, 2, 3] }; },
    assertStable: () => assert.fail('Full witness comparison should not run in stamp mode'),
    stability: { read: async () => { events.push('stamp'); return { run: 'r1', revision: 7, camera: [1, 2, 3] }; },
      validate: stamp => assert.equal(stamp.run, 'r1'), assertStable: (a, b) => assert.deepEqual(a, b) } };
  const work = experiment({ runtime, retain: async ({ observe, verify }) => {
    await observe(); events.push('capture'); await verify(); return {};
  } });
  await work.observe('one');
  assert.deepEqual(events, ['stamp', 'payload', 'capture', 'stamp']);
});

test('stamp mode catches changes during acquisition and capture and rejects partial interfaces', async () => {
  for (const phase of ['read', 'capture']) {
    let revision = 0;
    const runtime = { settle: async () => {}, camera: async () => {}, read: async () => {
      if (phase === 'read') revision++; return { geometry: [1] };
    }, assertStable: () => {}, stability: {
      read: async () => ({ revision }), validate: s => assert.equal(typeof s.revision, 'number'),
      assertStable: (a, b) => assert.equal(a.revision, b.revision, 'Revision changed'),
    } };
    const work = experiment({ runtime, retain: async ({ observe, verify }) => {
      await observe(); if (phase === 'capture') revision++; await verify(); return {};
    } });
    await assert.rejects(work.observe('changed'), /Revision changed/);
  }
  assert.throws(() => experiment({ runtime: { settle() {}, read() {}, camera() {}, assertStable() {},
    stability: { read() {} } }, retain() {} }), /stability.validate/);
});
