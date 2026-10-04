import assert from 'node:assert/strict';
import { authenticate, compare, validateBrowser } from './sam-pixel-boundary-browser-smoke.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bytes = Buffer.from(new Float32Array([1, 2]).buffer);
const descriptor = { dtype: 'float32', shape: [2], byteLength: 8,
  sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
assert.doesNotThrow(() => authenticate(bytes, descriptor));
assert.throws(() => authenticate(Buffer.alloc(8), descriptor), /hash/);
assert.throws(() => authenticate(bytes.subarray(0, 4), descriptor), /length/);
const nonfinite = Buffer.from(new Float32Array([NaN, 2]).buffer);
assert.throws(() => authenticate(nonfinite, { ...descriptor, sha256: `sha256:${createHash('sha256').update(nonfinite).digest('hex')}` }), /nonfinite/);
assert.throws(() => compare(new Float32Array(), new Float32Array()), /empty/);
assert.throws(() => compare(new Float32Array([1]), new Float32Array([1, 2])), /length/);
assert.throws(() => compare(new Float32Array([NaN]), new Float32Array([1])), /nonfinite/);
assert.throws(() => compare(new Float32Array([1]), new Float32Array([Infinity])), /nonfinite/);
assert.deepEqual(compare(new Float32Array([1, 3]), new Float32Array([1, 2])),
  { count: 2, maxAbs: 1, maxAbsIndex: 1, meanAbs: 0.5, rmse: Math.sqrt(0.5), signedMean: 0.5 });
assert.throws(() => validateBrowser('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), /independent/);
const dir = await mkdtemp(join(tmpdir(), 'sam-pixel-refusal-'));
const output = join(dir, 'report.json');
const child = spawnSync(process.execPath, [new URL('./sam-pixel-boundary-browser-smoke.mjs', import.meta.url).pathname],
  { env: { PATH: process.env.PATH, SAM_PIXEL_OUTPUT: output }, encoding: 'utf8' });
assert.equal(child.status, 1);
const report = JSON.parse(await readFile(output, 'utf8'));
assert.equal(report.status, 'failed');
assert.equal(report.phase, 'configuration');
assert.match(report.error.message, /SAM_PIXEL_REPO_ROOT/);
const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const wrongSourceOutput = join(dir, 'wrong-source.json');
const wrongSource = spawnSync(process.execPath, [new URL('./sam-pixel-boundary-browser-smoke.mjs', import.meta.url).pathname], {
  env: { PATH: process.env.PATH, SAM_PIXEL_OUTPUT: wrongSourceOutput, SAM_PIXEL_REPO_ROOT: root,
    SAM_PIXEL_COMMIT: 'sam-pixel-assay-invalid-revision-does-not-exist', SAM_PIXEL_BASELINE: 'ef447cea', SAM_PIXEL_PACKET_DIR: dir,
    SAM_PIXEL_RAW_DIR: dir, SAM_PIXEL_PREPARE_ONLY: '1' }, encoding: 'utf8',
});
assert.equal(wrongSource.status, 1);
const wrongSourceReport = JSON.parse(await readFile(wrongSourceOutput, 'utf8'));
assert.equal(wrongSourceReport.status, 'failed');
assert.match(wrongSourceReport.error.message, /sam-pixel-assay-invalid-revision-does-not-exist/);
const ancestorOutput = join(dir, 'ancestor-source.json');
const ancestor = spawnSync(process.execPath, [new URL('./sam-pixel-boundary-browser-smoke.mjs', import.meta.url).pathname], {
  env: { PATH: process.env.PATH, SAM_PIXEL_OUTPUT: ancestorOutput, SAM_PIXEL_REPO_ROOT: root,
    SAM_PIXEL_COMMIT: 'c94502ac', SAM_PIXEL_BASELINE: 'ef447cea', SAM_PIXEL_PACKET_DIR: dir,
    SAM_PIXEL_RAW_DIR: dir, SAM_PIXEL_PREPARE_ONLY: '1' }, encoding: 'utf8',
});
assert.equal(ancestor.status, 1, 'missing packet still refuses');
const ancestorReport = JSON.parse(await readFile(ancestorOutput, 'utf8'));
assert.equal(ancestorReport.phase, 'packet-authentication', 'valid ancestor must reach packet authentication');
assert.match(ancestorReport.error.message, /tensor-manifest.json/);
console.log('pixel boundary refusal contracts passed; durable failure:', output);
