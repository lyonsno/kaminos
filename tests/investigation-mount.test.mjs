// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {deserialize} from 'node:v8';
import {createInvestigationRecording, investigationOperations} from '../investigation-recording.mjs';
import {readObservationSession} from '../observation-session.mjs';
import {createRgbPng} from './png-fixture.mjs';

const moduleUrl = new URL('../investigation-mount.mjs', import.meta.url);
const source = {route: 'synthetic-owner-mount', revision: 'test-1'};
const png = createRgbPng(2, 1, [200, 0, 0, 0, 200, 0]);
async function fixture(t, overrides = {}) {
  assert.ok(existsSync(moduleUrl), 'shared owner mount must exist independently of Fluid');
  const {mountInvestigation} = await import(moduleUrl);
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'owner-mount-'));
  t.after(() => fs.rm(out, {recursive: true, force: true}));
  const page = new EventEmitter(), browser = new EventEmitter(), frame = {};
  page.context = () => ({browser: () => browser});
  page.mainFrame = () => frame;
  page.isClosed = () => false;
  page.screenshot = async () => png;
  page.exposeBinding = async (name, callback) => {page.binding = callback;};
  overrides.onPage?.(page, browser);
  const state = {frame: 17, view: {position: [1, 2, 3]}};
  let recorder, present = true;
  const install = async ({id}) => {
    recorder = createInvestigationRecording({id, source, initial: state,
      startingConditions: {kind: 'retained-source', reconstructAfterRestart: true}});
    return {
      read: async () => ({recording: recorder.snapshot(), context: structuredClone(state)}),
      finish: async () => ({recording: recorder.finish(), context: structuredClone(state)}),
      disconnect: async () => {recorder.finish();}, saveFailed: async () => {},
      isPresent: async () => present,
    };
  };
  t.after(() => recorder?.finish());
  const handle = await mountInvestigation({page, out, source, install, ...overrides});
  return {handle, out, page, state, disappear: () => {present = false;},
    report: async () => JSON.parse(await fs.readFile(handle.reportPath))};
}

test('owner context, image and operation prefix share the existing retention writer', async t => {
  const f = await fixture(t);
  investigationOperations.emit({kind: 'creature.seek', phase: 'applied', target: 'root', effective: {frame: 17}});
  await f.handle.capture('interesting pose');
  const report = await f.report();
  const capture = await readObservationSession(path.join(report.captures[0].out, 'report.json'));
  assert.equal(capture.result.after.context.frame, 17);
  assert.equal(capture.result.after.recording.operations.length, 1);
  await f.handle.finish('keep');
  const saved = deserialize(await fs.readFile(path.join(f.out, 'recording.v8')));
  assert.equal(saved.recording.complete, true);
  assert.equal(saved.context.frame, 17);
  assert.equal((await f.handle.finished).status, 'finished');
});

test('owner transaction surrounds retention; restore failure preserves acquired image and fails capture', async t => {
  const calls = [];
  const f = await fixture(t, {captureKind: 'held-source-frame', aroundCapture: async retain => {
    calls.push('hold');
    try {await retain(); calls.push('retained');}
    finally {calls.push('restore'); throw Error('restore failed');}
  }});
  await assert.rejects(f.handle.capture('hold'), /restore failed/);
  assert.deepEqual(calls, ['hold', 'retained', 'restore']);
  const report = await f.report();
  assert.equal(report.captures[0].kind, 'held-source-frame');
  assert.equal(report.captures[0].status, 'failed');
  assert.deepEqual(await fs.readFile(path.join(report.captures[0].out, 'display.png')), png);
  await f.handle.finish('retain failed restore');
});

test('transaction cannot substitute a return value for actual retention', async t => {
  const f = await fixture(t, {aroundCapture: async () => ({status: 'passed'})});
  await assert.rejects(f.handle.capture(), /exactly once/);
  assert.equal((await f.report()).captures[0].status, 'failed');
  await f.handle.finish();
});

test('installation failure writes durable failure phase and rejects mount', async t => {
  assert.ok(existsSync(moduleUrl), 'shared owner mount must exist independently of Fluid');
  const {mountInvestigation} = await import(moduleUrl);
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'owner-mount-fail-'));
  t.after(() => fs.rm(out, {recursive: true, force: true}));
  const page = new EventEmitter(); page.exposeBinding = async () => {};
  page.context = () => ({browser: () => null}); page.isClosed = () => false;
  await assert.rejects(mountInvestigation({page, out, source, install: async () => {throw Error('owner unavailable');}}), /owner unavailable/);
  const report = JSON.parse(await fs.readFile(path.join(out, 'investigation.json')));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'install');
  assert.match(report.failure, /owner unavailable/);
});

test('page replacement rejects pending handback and retains previous capture', async t => {
  const f = await fixture(t);
  await f.handle.capture();
  f.disappear(); f.page.emit('framenavigated', f.page.mainFrame());
  await assert.rejects(f.handle.finished, /replaced/);
  assert.equal((await f.report()).captures[0].status, 'retained');
  assert.equal((await f.report()).status, 'disconnected');
});

test('capture binding accepts only its owned main frame', async t => {
  const f = await fixture(t);
  await assert.rejects(f.page.binding({page: f.page, frame: {}}, {action: 'capture'}), /main frame/);
  await assert.rejects(f.page.binding({page: {}, frame: f.page.mainFrame()}, {action: 'capture'}), /page differs/);
  assert.equal((await f.report()).captures.length, 0);
  await f.handle.finish();
});

test('page close during startup persistence rejects mount and removes listeners', async t => {
  const original = fs.writeFile;
  let page, browser;
  t.after(() => {fs.writeFile = original;});
  fs.writeFile = async (file, data, ...args) => {
    if (String(file).endsWith('investigation.json.next') && JSON.parse(data).status === 'recording')
      page.emit('close');
    return original(file, data, ...args);
  };
  let leaked;
  try {
    await assert.rejects(fixture(t, {install: async () => {
      return {read: async () => ({}), finish: async () => ({}),
        disconnect: async () => {}, saveFailed: async () => {}, isPresent: async () => true};
    }, onPage: (p, b) => {page = p; browser = b;}}).then(value => {leaked = value;}), /Owned page lost/);
  } finally {leaked?.page.emit('close'); await leaked?.handle.finished.catch(() => {});}
  assert.equal(page.listenerCount('close'), 0);
  assert.equal(page.listenerCount('framenavigated'), 0);
  assert.equal(browser.listenerCount('disconnected'), 0);
});
