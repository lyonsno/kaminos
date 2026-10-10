import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readObservationSession} from '../observation-session.mjs';
import {createRgbPng} from './png-fixture.mjs';

const moduleUrl = new URL('../investigation-capture.mjs', import.meta.url);
const source = {route: 'synthetic-retention-fixture', revision: 'fixture-1'};
const png = createRgbPng(2, 1, [200, 0, 0, 0, 200, 0]);
const state = () => ({recording: {id: 'r1', source, complete: true, sequence: 2,
  operations: [{sequence: 1, effective: 0.1}, {sequence: 2, effective: 0.2}],
  startingConditions: {kind: 'live-runtime', reconstructAfterRestart: false}},
context: {clock: {generation: 1, step: 47}, camera: {up: [0, -1, 0]}}});
async function setup(t) {
  assert.ok(existsSync(moduleUrl), 'capture must retain the actual display with the recorded exploration');
  const {retainInvestigationCapture} = await import(moduleUrl);
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'investigation-capture-'));
  t.after(() => fs.rm(out, {recursive: true, force: true}));
  return {out, retainInvestigationCapture, readReport: () => readObservationSession(path.join(out, 'report.json'))};
}

test('captures before subsequent context reads and retains the full exploration plus operator note', async t => {
  const f = await setup(t), calls = [];
  await f.retainInvestigationCapture({out: f.out, source, recordingId: 'r1', note: 'look behind this edge',
    read: async () => {calls.push('read'); return state();},
    capture: async () => {calls.push('display'); return png;}});
  assert.deepEqual(calls, ['read', 'display', 'read']);
  const report = await f.readReport();
  assert.equal(report.result.interval, 'no-observed-change');
  assert.equal(report.result.note, 'look behind this edge');
  assert.equal(report.result.after.recording.operations.length, 2);
  assert.equal(report.observations[0].effective.recording.startingConditions.reconstructAfterRestart, false);
  assert.deepEqual(await fs.readFile(path.join(f.out, 'display.png')), png);
});

test('advancement during capture is an interval, preserving both ends instead of claiming an exact instant', async t => {
  const f = await setup(t); let reads = 0;
  await f.retainInvestigationCapture({out: f.out, source, recordingId: 'r1',
    read: async () => {const s = state(); if (++reads > 1) {s.context.clock.step = 49; s.recording.sequence = 3;} return s;},
    capture: async () => png});
  const report = await f.readReport();
  assert.equal(report.result.interval, 'changed-during-capture');
  assert.equal(report.observations[0].effective.context.clock.step, 47);
  assert.equal(report.result.after.context.clock.step, 49);
});

test('source drift or an incomplete recording fails with actual pixels and both reads retained', async t => {
  for (const failure of ['source', 'incomplete', 'recording-id']) {
    const f = await setup(t); let reads = 0;
    await assert.rejects(f.retainInvestigationCapture({out: f.out, source, recordingId: 'r1',
      read: async () => {const s = state(); if (++reads > 1) {
        if (failure === 'source') s.recording.source = {route: 'wrong-source'};
        if (failure === 'incomplete') s.recording.complete = false;
        if (failure === 'recording-id') s.recording.id = 'r2';
      } return s;}, capture: async () => png}), /source|incomplete|identity/);
    const report = await f.readReport();
    assert.equal(report.status, 'failed');
    assert.ok(report.result.after);
    assert.deepEqual(await fs.readFile(path.join(f.out, 'display.png')), png);
  }
});

test('display failure retains the pre-capture exploration and an explicit failure phase', async t => {
  const f = await setup(t);
  await assert.rejects(f.retainInvestigationCapture({out: f.out, source, recordingId: 'r1',
    read: async () => state(), capture: async () => {throw Error('page disappeared');}}), /page disappeared/);
  const report = await f.readReport();
  assert.equal(report.phase, 'observe:display:capture');
  assert.equal(report.observations[0].effective.recording.operations.length, 2);
  assert.equal(report.result.after, null);
});
