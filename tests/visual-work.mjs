import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertMountedScene, assertSavedResult, assertCapturePixels } from '../visual-work.mjs';
import { assertCapturePixels as pureCapturePixels } from '../capture-pixels.mjs';

const object = { id: 'chair', type: 'glb', source: '/real.glb', transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } };
test('startup failure survives before the scene report exists', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-work-failure-'));
  try {
    assert.throws(() => execFileSync(process.execPath, ['visual-work-run.mjs', '--out', out], { cwd: new URL('..', import.meta.url), stdio: 'pipe' }));
    const report = JSON.parse(await fs.readFile(path.join(out, 'failure.json')));
    assert.equal(report.status, 'failed');
    assert.equal(report.phase, 'arguments');
    assert.match(report.failure, /--origin required/);
  } finally { await fs.rm(out, { recursive: true }); }
});
test('malformed arguments with a supplied output path retain parser failure', async () => {
  for (const extra of [['--origin'], ['--unknown-flag']]) {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-work-parse-failure-'));
    try {
      assert.throws(() => execFileSync(process.execPath, ['visual-work-run.mjs', '--out', out, ...extra], { cwd: new URL('..', import.meta.url), stdio: 'pipe' }));
      const report = JSON.parse(await fs.readFile(path.join(out, 'failure.json')));
      assert.equal(report.status, 'failed');
      assert.equal(report.phase, 'arguments');
      assert.match(report.failure, /argument|option/i);
    } finally { await fs.rm(out, { recursive: true }); }
  }
});
test('mount requires requested identity, source and authored pose', () => {
  const document = { objects: [object] };
  assertMountedScene(document, [{ ...object, extraTelemetry: true }]);
  for (const actual of [[], [{ ...object, source: '/demo.glb' }], [{ ...object, id: 'other' }],
    [{ ...object, transform: { ...object.transform, position: [9, 1, 0] } }]]) {
    assert.throws(() => assertMountedScene(document, actual), /mount/i);
  }
});

test('capture rejects blank, transparent and inconsistent pixels', () => {
  assert.equal(assertCapturePixels, pureCapturePixels, 'Legacy export must use the shared predicate');
  const capture = { width: 2, height: 1 };
  const decoded = { width: 2, height: 1, channels: 4, pixels: Buffer.from([20, 30, 40, 255, 70, 60, 50, 255]) };
  assertCapturePixels(decoded, capture);
  for (const bad of [{ ...decoded, pixels: Buffer.alloc(8) }, { ...decoded, pixels: Buffer.from([20,30,40,0,70,60,50,0]) },
    { ...decoded, width: 10 }, { ...decoded, pixels: Buffer.alloc(8, 255) }]) {
    assert.throws(() => assertCapturePixels(bad, capture), /capture/i);
  }
});
test('save refuses failed, mismatched and missing document results', () => {
  const document = { objects: [object], camera: { position: [0, 1, 2] } };
  const result = { ok: true, filename: 'chair.kaminos.json', url: 'http://localhost/#authoring=1&scene=chair.kaminos.json', document };
  assertSavedResult(result, document);
  for (const bad of [false, { ok: false, error: 'busy' }, { ...result, filename: undefined },
    { ...result, url: 'http://localhost/#scene=other.kaminos.json' }]) {
    assert.throws(() => assertSavedResult(bad, document), /save/i);
  }
  assert.throws(() => assertSavedResult(result, { ...document, camera: { position: [9, 1, 2] } }), /persisted/i);
});
