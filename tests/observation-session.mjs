import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { observationSession } from '../observation-session.mjs';
import * as observationKit from '../observation-session.mjs';
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

test('observation kit executes with only its decoder and pure pixel predicate deployed', async t => {
  const out = await workspace(t), root = new URL('../', import.meta.url);
  const modules = ['observation-session.mjs', 'screenshot-png-rgb.mjs', 'capture-pixels.mjs'];
  for (const filename of await fs.readdir(root)) {
    if (modules.includes(filename)) await fs.copyFile(new URL(filename, root), path.join(out, filename));
  }
  const script = `
    import assert from 'node:assert/strict';
    import { observationSession, readObservationSession } from './observation-session.mjs';
    const state = { run: 'standalone-kit', step: 7 };
    const session = await observationSession({ out: './retained', source: { route: 'isolated-library-test' },
      capture: async () => Buffer.from(process.argv[1], 'base64'),
      exercise: ({ retain }) => retain({ name: 'standalone', observe: async () => state, verify: async () => {} }) });
    assert.equal(session.status, 'passed');
    assert.deepEqual(session.result.effective, state);
    const restored = await readObservationSession('./retained/report.json');
    assert.deepEqual(restored.observations[0].effective, state);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script, png.toString('base64')], { cwd: out, stdio: 'pipe' });
});

test('retains PNG, actual caller state and source without scene-save machinery', async t => {
  const out = await workspace(t);
  await observationSession({ out, source, capture: async () => png, exercise: async ({ retain }) => {
    const work = experiment({ runtime: runtime(), retain });
    await work.observe('front'); await work.observe('back');
  } });
  const report = await readReport(out);
  assert.equal(report.status, 'passed'); assert.equal(report.lastTrustworthyObservation, 'back');
  assert.deepEqual(report.source, source); assert.equal(report.observations.length, 2);
  const restored = await observationKit.readObservationSession(path.join(out, 'report.json'));
  assert.equal(restored.observations[0].effective.seconds, .5);
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

test('disk index excludes dense observations and caller results while live returns stay compatible', async t => {
  const out = await workspace(t);
  const state = { run: 'stone', fractureHistory: Array.from({ length: 200 }, (_, i) => ({ id: i, position: [i, -i, i / 3] })),
    velocity: new Float64Array([1, -0, NaN, Infinity]), generation: 7n, optional: undefined };
  let returned;
  const session = await observationSession({ out, source, capture: async () => png, exercise: async ({ retain }) => {
    const work = experiment({ runtime: { ...runtime(), read: async () => state }, retain });
    returned = { first: await work.observe('first'), second: await work.observe('second'), custom: { allState: state } };
    return returned;
  } });
  assert.equal(session.result, returned);
  assert.deepEqual(session.result.first.observed, state);
  assert.deepEqual(session.observations[0].effective, state);
  const disk = await readReport(out);
  assert.equal(disk.observations[0].effective, undefined, 'Dense raw state must not enter the JSON index');
  assert.equal(disk.result, undefined, 'Dense caller return must not enter the JSON index');
  assert.equal(disk.storageFormat, 'observation-session-v2');
  assert.equal(disk.observations[0].state.encoding, 'node-v8');
  assert.equal(disk.resultRef.encoding, 'node-v8');
  const restored = await observationKit.readObservationSession(path.join(out, 'report.json'));
  assert.deepEqual(restored.observations.map(o => o.effective), [state, state]);
  assert.deepEqual(restored.result, returned);
});

test('dense JSON-compatible data is externalized rather than repeatedly stringified', async t => {
  const out = await workspace(t);
  const state = { route: 'native-requested', effectiveRoute: 'native-requested', fractureHistory: [1, 2, 3] };
  const stringify = JSON.stringify;
  JSON.stringify = (value, replacer, space) => stringify(value, (key, item) => {
    assert.notEqual(item, state, 'Writer tried to serialize raw observation into aggregate JSON');
    return typeof replacer === 'function' ? replacer(key, item) : item;
  }, space);
  try {
    await observationSession({ out, source, capture: async () => png, exercise: async ({ retain }) => {
      const first = await retain({ name: 'one', observe: async () => state, verify: async () => {} });
      const second = await retain({ name: 'two', observe: async () => state, verify: async () => {} });
      return { first, second, callerSelected: state };
    } });
  } finally { JSON.stringify = stringify; }
  const disk = await readReport(out);
  assert.equal(disk.status, 'passed');
  assert.equal(disk.observations[0].effective, undefined);
});

test('state survives capture and verification failures with the previous verified observation', async t => {
  for (const phase of ['capture', 'verify']) {
    const out = await workspace(t); let current = 'good';
    const state = { current: 'suspect', fullTopology: [0, 1, 2], requestedRoute: 'native', effectiveRoute: 'native' };
    await assert.rejects(observationSession({ out, source, capture: async () => {
      if (current === 'suspect' && phase === 'capture') throw Error('capture device lost');
      return png;
    }, exercise: async ({ retain }) => {
      await retain({ name: 'good', observe: async () => ({ current }), verify: async () => {} });
      current = 'suspect';
      await retain({ name: 'suspect', observe: async () => state, verify: async () => { throw Error('verify run changed'); } });
    } }), /device lost|run changed/);
    const disk = await readReport(out);
    assert.equal(disk.status, 'failed');
    assert.equal(disk.lastTrustworthyObservation, 'good');
    assert.ok(disk.observations[1].state, 'Failure must leave a retained raw state reference');
    const restored = await observationKit.readObservationSession(path.join(out, 'report.json'));
    assert.deepEqual(restored.observations[1].effective, state);
    if (phase === 'verify') assert.deepEqual(await fs.readFile(path.join(out, 'suspect.png')), png);
  }
});

test('reader preserves legacy inline reports and rejects unsupported formats', async t => {
  const out = await workspace(t), reportPath = path.join(out, 'report.json');
  const legacy = { status: 'passed', source, observations: [{ name: 'old', effective: { run: 1 } }], result: { value: 42 } };
  await fs.writeFile(reportPath, JSON.stringify(legacy));
  assert.deepEqual(await observationKit.readObservationSession(reportPath), legacy);
  await fs.writeFile(reportPath, JSON.stringify({ ...legacy, storageFormat: 'future' }));
  await assert.rejects(observationKit.readObservationSession(reportPath), /Unsupported observation storage format/);
});

test('reader refuses missing, partial, tampered and conflicting payload references', async t => {
  const out = await workspace(t), reportPath = path.join(out, 'report.json');
  await observationSession({ out, source, capture: async () => png, exercise: ({ retain }) =>
    experiment({ runtime: runtime(), retain }).observe('kept') });
  const disk = await readReport(out), ref = disk.observations[0].state;
  const statePath = path.join(out, ref.file), bytes = await fs.readFile(statePath);
  await fs.rename(statePath, `${statePath}.held`);
  await assert.rejects(observationKit.readObservationSession(reportPath), /ENOENT/);
  await fs.writeFile(statePath, bytes.subarray(0, bytes.length - 1));
  await assert.rejects(observationKit.readObservationSession(reportPath), /size differs/);
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  await fs.writeFile(statePath, corrupt);
  await assert.rejects(observationKit.readObservationSession(reportPath), /checksum differs/);
  await fs.writeFile(statePath, bytes);
  for (const patch of [{ encoding: 'json' }, { file: '../other.v8' }, { bytes: String(ref.bytes) }, { sha256: undefined }]) {
    await fs.writeFile(reportPath, JSON.stringify({ ...disk,
      observations: [{ ...disk.observations[0], state: { ...ref, ...patch } }] }));
    await assert.rejects(observationKit.readObservationSession(reportPath), /reference|size|checksum/);
  }
  await fs.writeFile(reportPath, JSON.stringify({ ...disk, observations: [{ ...disk.observations[0], state: undefined }] }));
  await assert.rejects(observationKit.readObservationSession(reportPath), /state reference missing/);
  await fs.writeFile(reportPath, JSON.stringify({ ...disk, resultRef: undefined }));
  await assert.rejects(observationKit.readObservationSession(reportPath), /result reference missing/);
});

test('result serialization failure leaves complete primary observations and a failure report', async t => {
  const out = await workspace(t);
  await assert.rejects(observationSession({ out, source, capture: async () => png, exercise: async ({ retain }) => {
    await experiment({ runtime: runtime(), retain }).observe('kept');
    return { cannotClone: () => {} };
  } }), /could not be cloned/);
  const disk = await readReport(out);
  assert.equal(disk.status, 'failed'); assert.equal(disk.phase, 'retain-result');
  assert.equal(disk.lastTrustworthyObservation, 'kept');
  assert.equal(disk.resultRef, undefined);
  const restored = await observationKit.readObservationSession(path.join(out, 'report.json'));
  assert.equal(restored.observations[0].effective.run, 'r1');
  assert.deepEqual(await fs.readFile(path.join(out, 'kept.png')), png);
});

test('payload collision fails without overwriting evidence or hiding the failure', async t => {
  const out = await workspace(t);
  const existing = Buffer.from('prior evidence');
  await fs.writeFile(path.join(out, 'kept.state.v8'), existing);
  await assert.rejects(observationSession({ out, source, capture: async () => png, exercise: ({ retain }) =>
    experiment({ runtime: runtime(), retain }).observe('kept') }), /EEXIST/);
  const disk = await readReport(out);
  assert.equal(disk.status, 'failed'); assert.equal(disk.phase, 'observe:kept:state');
  assert.equal(disk.lastTrustworthyObservation, undefined);
  assert.equal(disk.observations[0].state, undefined);
  assert.deepEqual(await fs.readFile(path.join(out, 'kept.state.v8')), existing);
});

test('caught retention failure still retains caller result without replacing the capture failure phase', async t => {
  const out = await workspace(t), result = { diagnostic: { full: [1, 2, 3] } };
  await assert.rejects(observationSession({ out, source, capture: async () => { throw Error('device lost'); },
    exercise: async ({ retain }) => {
      try { await experiment({ runtime: runtime(), retain }).observe('broken'); } catch {}
      return result;
    },
  }), /device lost/);
  const restored = await observationKit.readObservationSession(path.join(out, 'report.json'));
  assert.deepEqual(restored.result, result);
  assert.equal(restored.phase, 'observe:broken:capture');
});

test('uncopyable diagnostics cannot mask an earlier capture failure', async t => {
  const out = await workspace(t);
  await assert.rejects(observationSession({ out, source, capture: async () => { throw Error('primary device lost'); },
    exercise: async ({ retain }) => {
      try { await experiment({ runtime: runtime(), retain }).observe('broken'); } catch {}
      return { function: () => {} };
    },
  }), /primary device lost/);
  const disk = await readReport(out);
  assert.match(disk.resultRetentionFailure || '', /could not be cloned/);
  assert.match(disk.failure, /primary device lost/);
  assert.equal(disk.phase, 'observe:broken:capture');
});
