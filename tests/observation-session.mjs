import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { observationSession } from '../observation-session.mjs';
import { experiment } from '../experiment-work.mjs';
import { createRgbPng } from './png-fixture.mjs';

const png = createRgbPng(2, 1, [200, 0, 0, 0, 200, 0]);
const source = { route: 'synthetic-retention-test', revision: 'fixture-v1' };
const runtime = () => ({ settle: async () => {}, read: async () => ({ run: 'r1', completed: 30, seconds: .5 }),
  camera: async view => view, assertStable: (a, b) => assert.deepEqual(a, b) });
async function workspace(t) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'observations-'));
  t.after(() => fs.rm(out, { recursive: true, force: true })); return out;
}
const readReport = async out => JSON.parse(await fs.readFile(path.join(out, 'report.json'), 'utf8'));

test('retains PNG, actual caller state and source without scene-save machinery', async t => {
  const out = await workspace(t);
  await observationSession({ out, source, capture: async () => png, exercise: async ({ retain }) => {
    const work = experiment({ runtime: runtime(), retain });
    await work.observe('front'); await work.observe('back');
  } });
  const report = await readReport(out);
  assert.equal(report.status, 'passed'); assert.equal(report.lastTrustworthyObservation, 'back');
  assert.deepEqual(report.source, source); assert.equal(report.observations.length, 2);
  assert.equal(report.observations[0].effective.seconds, .5);
  assert.deepEqual(await fs.readFile(path.join(out, 'front.png')), png);
  assert.equal(report.observations[0].width, 2);
  await assert.rejects(observationSession({ out, source }), /EEXIST/);
  assert.deepEqual(await readReport(out), report);
});

test('caught capture failure cannot silently certify a session', async t => {
  const out = await workspace(t);
  await assert.rejects(observationSession({ out, source, capture: async () => { throw Error('device lost'); },
    exercise: async ({ retain }) => { try { await experiment({ runtime: runtime(), retain }).observe('broken'); } catch {} },
  }), /device lost/);
  const report = await readReport(out);
  assert.equal(report.status, 'failed'); assert.match(report.phase, /broken/);
  assert.equal(report.lastTrustworthyObservation, undefined);
});

test('blank or malformed PNG stays failed, with raw capture retained', async t => {
  for (const bytes of [Buffer.from('partial'), createRgbPng(2, 1, [0, 0, 0, 0, 0, 0])]) {
    const out = await workspace(t);
    await assert.rejects(observationSession({ out, source, capture: async () => bytes,
      exercise: ({ retain }) => experiment({ runtime: runtime(), retain }).observe('bad') }), /PNG|Capture/);
    const report = await readReport(out); assert.equal(report.status, 'failed');
    assert.equal(report.observations[0].status, 'unverified');
    assert.deepEqual(await fs.readFile(path.join(out, 'bad.png')), bytes);
  }
});

test('changed runtime retains suspect pixels and previous trustworthy observation', async t => {
  const out = await workspace(t); let run = 'r1', captures = 0;
  const adapter = { ...runtime(), read: async () => ({ run }) };
  await assert.rejects(observationSession({ out, source, capture: async () => { if (++captures === 2) run = 'r2'; return png; },
    exercise: async ({ retain }) => { const work = experiment({ runtime: adapter, retain }); await work.observe('good'); await work.observe('reset'); },
  }), /r2/);
  const report = await readReport(out);
  assert.equal(report.lastTrustworthyObservation, 'good'); assert.equal(report.observations[1].status, 'unverified');
});

test('failure before primary output writes phase and source', async t => {
  const out = await workspace(t);
  await assert.rejects(observationSession({ out, source, capture: async () => png, exercise: async () => { throw Error('route mismatch'); } }), /route mismatch/);
  const report = await readReport(out); assert.equal(report.phase, 'exercise'); assert.equal(report.status, 'failed');
  assert.deepEqual(report.source, source); assert.deepEqual(report.observations, []);
});
