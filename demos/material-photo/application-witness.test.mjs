import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { readRawEvidence } from './witness-raw.mjs';

test('real rendering wait admits healthy optional-error state and exposes actual errors', async () => {
  const { renderingAdvanced } = await import('./application-witness.mjs');
  assert.equal(typeof renderingAdvanced, 'function', 'browser wait must be executable by contract tests');
  for (const stopOnTerminal of [true, false]) {
    const window = { __photoLifecycle: { terminal: null }, __materialPhoto: {},
      __materialPhotoActions: { presentation: () => ({ renderCallbacks: { rendered: 4 } }) } };
    const run = before => vm.runInNewContext(`(${renderingAdvanced})({before:${before},counter:'rendered',stopOnTerminal:${stopOnTerminal}})`, { window });
    assert.equal(run(3), true);
    assert.equal(run(4), false);
    window.__materialPhoto.gpuErrors = ['GPU validation failed'];
    assert.equal(run(4), true);
  }
});

for (const corrupt of [false, true]) test(`retained output corruption is ${corrupt ? 'rejected' : 'absent across the complete lifecycle'}`, async () => {
  const { exercisePhotoApplications } = await import('./application-witness.mjs');
  const geometry = () => ({ width: 1, height: 1, depth: new Float32Array([1]),
    normals: new Float32Array([0, 0, 1]), points: new Float32Array([0, 0, 1]), colors: new Float32Array([1, 0, 0]) });
  const output = () => ({ width: 1, height: 1,
    maps: Object.fromEntries(['albedo','roughness','metallic','orm'].map(name => [name, { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) }])),
    planes: { albedo: new Float32Array([1, 2, 3]), orm: new Float32Array([4, 5, 6]) } });
  const retained = { image: { width: 1, height: 1, data: new Uint8Array([4, 5, 6, 255]) }, output: output(), geometry: geometry() };
  const host = { device: {}, session: { snapshot: () => ({ status: 'active' }) }, foreground: {} };
  const model = kind => {
    let calls = 0, active = false, paused = false, destroyed = false;
    return { ...host, model: { useRealWeights: true }, load: async () => {},
      async infer({ signal, onRunProgress }) {
        active = true; calls++; onRunProgress?.({ duties: 1 });
        try {
          if (calls === (kind === 'geometry' ? 1 : 2)) await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              if (kind === 'materials' && corrupt) retained.output.maps.albedo.data.fill(0);
              reject(new DOMException('stopped', 'AbortError'));
            }, { once: true });
          });
          return kind === 'geometry' ? geometry() : output();
        } finally { active = false; paused = false; }
      },
      pause: async () => { paused = true; }, destroy: async () => { destroyed = true; },
      snapshot: () => ({ loaded: !destroyed, destroyed, phase: active ? 'inferring' : 'idle', error: null,
        control: active ? { activeDutyCount: 1, status: paused ? 'paused' : 'running' } : null }),
    };
  };
  const apps = { ...host, geometry: model('geometry'), materials: model('materials') };
  let frames = 0;
  const window = { __materialPhoto: { gpuErrors: [] }, __materialPhotoActions: {
    inferenceApps: () => apps, materialEvidence: () => retained, exampleEvidence: () => retained,
    presentation: () => ({ physicalbaseline: { activeMaterial: { mapUUID: 'unchanged-texture' } },
      renderCallbacks: { rendered: ++frames, duringModel: frames } }),
  } };
  const previous = globalThis.window; globalThis.window = window;
  const page = { evaluate: async (fn, arg) => typeof fn === 'string' ? vm.runInNewContext(fn, { window, Uint8Array, btoa }) : fn(arg),
    waitForFunction: async (fn, arg) => { while (!fn(arg)) await new Promise(setImmediate); } };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-retained-corruption-')), report = {};
  try {
    const run = exercisePhotoApplications(page, out, report, async () => {});
    if (corrupt) await assert.rejects(run, /Retry changed raw output/);
    else { await run; assert.equal(report.application.phase, 'passed'); }
  }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('missing native generation writes a failure report before any browser launch', () => {
  const root = path.resolve(import.meta.dirname, '../..'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-application-invalid-'));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const child = spawnSync(process.execPath, [path.join(root, 'demos/material-photo/examples-witness.mjs'),
    '--repo-root', root, '--expected-commit', revision, '--chrome', '/not-a-browser',
    '--playwright-module', '/not-a-module', '--url', 'http://127.0.0.1:1/', '--output', out, '--application'], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json')));
  assert.equal(report.status, 'failed');
  assert.equal(report.phase, 'arguments');
  assert.match(report.error, /--application requires fresh --generate/);
  assert.equal(report.browser, undefined);
});

test('geometry arrays are retained completely, with the real typed layout', async () => {
  for (const name of ['depth', 'normals', 'points', 'colors']) {
    const data = new Float32Array(name === 'depth' ? [1, 2] : [1, 2, 3, 4, 5, 6]);
    const source = { geometry: { width: 2, height: 1, [name]: data } };
    const evaluate = async expression => Function('source', `return ${expression}`)(source);
    const raw = await readRawEvidence(evaluate, `geometry-${name}`, 'source');
    assert.equal(raw.type, 'Float32Array');
    assert.deepEqual(raw.bytes, Buffer.from(data.buffer));
  }
});

test('lifecycle evidence refuses false cancellation, stale output and absent rendering', async () => {
  const file = new URL('./application-witness.mjs', import.meta.url);
  assert.ok(fs.existsSync(file), 'real photograph application witness must exist');
  const { validateCancellation, validateRetry } = await import(file.href);
  const good = { stage: 'geometry', paused: { status: 'paused' }, frames: 2,
    terminal: { status: 'rejected', name: 'AbortError' }, displayedBefore: 'material-1', displayedAfter: 'material-1',
    operation: { stage: null, phase: null }, model: { loaded: true, phase: 'idle', error: null } };
  validateCancellation(good);
  for (const patch of [{ terminal: { status: 'resolved' } }, { paused: null }, { frames: 0 },
    { displayedAfter: 'replaced' }, { displayedBefore: null, displayedAfter: null },
    { model: { loaded: true, phase: 'finishing' } }, { operation: { stage: 'geometry' } }]) {
    assert.throws(() => validateCancellation({ ...good, ...patch }));
  }
  const baseline = { width: 2, height: 1, type: 'Float32Array', bytes: Buffer.from([1, 2, 3, 4]) };
  validateRetry(baseline, baseline);
  for (const patch of [{ width: 1 }, { type: 'Uint8Array' }, { bytes: Buffer.from([0, 2, 3, 4]) }, { bytes: Buffer.alloc(0) }]) {
    assert.throws(() => validateRetry(baseline, { ...baseline, ...patch }));
  }
});
