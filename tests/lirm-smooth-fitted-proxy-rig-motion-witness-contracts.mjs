#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  assertCapturedFrameSet,
  assertInspectorIdentity,
  prepareFrameDirectory,
  verifyPng,
} from '../lirm-smooth-fitted-proxy-rig-motion-witness.mjs';

const scriptPath = new URL('../lirm-smooth-fitted-proxy-rig-motion-witness.mjs', import.meta.url);
assert.ok(existsSync(scriptPath), 'dense motion witness runner must exist');
const script = readFileSync(scriptPath, 'utf8');

assert.match(script, /requestedRoute/, 'witness must record requested route identity');
assert.match(script, /effectiveRoute/, 'witness must record effective route identity');
assert.match(script, /effective route mismatch/, 'witness must reject a fallback or wrong route');
assert.match(script, /source hash mismatch/, 'witness must reject source drift');
assert.match(script, /registration hash mismatch/, 'witness must reject registration drift');
assert.match(script, /dense motion did not mount/, 'witness must reject missing motion state');
assert.match(script, /captured frame count mismatch/, 'witness must reject partial capture');
assert.match(script, /screenshot is too small/, 'witness must reject blank or partial frames');
assert.match(script, /failurePhase/, 'witness must preserve pre-output failure phase');
assert.match(script, /writeReport/, 'witness must write a durable report on success and failure');
assert.match(script, /profile/, 'witness must capture the required profile view');
assert.match(script, /three-quarter/, 'witness must capture the required three-quarter view');

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  return crc >>> 0;
});
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const kind = Buffer.from(type);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([header, kind, data, checksum]);
};
const rgbaPng = (width, height, pixel, trailingBytes = 0) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) row.set(pixel(x, y), 1 + x * 4);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
    Buffer.alloc(trailingBytes, 17),
  ]);
};

const uniformButLarge = rgbaPng(320, 256, () => [24, 24, 24, 255], 5000);
assert.throws(
  () => verifyPng(uniformButLarge, 'uniform-large'),
  /luminanceStdDev|edgeRatio|activePixelRatio/,
  'a large syntactically valid but blank PNG must fail pixel credibility',
);
const occupied = rgbaPng(320, 256, (x, y) => {
  const dx = (x - 160) / 92;
  const dy = (y - 118) / 54;
  if (dx * dx + dy * dy < 1) return [90 + (x % 60), 142 + (y % 70), 48, 255];
  return y > 205 ? [112, 105, 82, 255] : [18, 20, 22, 255];
});
assert.doesNotThrow(() => verifyPng(occupied, 'occupied'));

const exactInspectorState = {
  effectiveRoute: 'kaminos/fitted-proxy-rig/exact-glb-smooth-curve-stress-v0',
  sourceHash: '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  registrationHash: 'a63fa02ffa7a144234eef3b9902ac9d349fd413d93a19c87ee1464b0b61ca7f9',
  effectiveAmplitude: 0.18,
  denseMotion: { status: 'mounted' },
};
assert.doesNotThrow(() => assertInspectorIdentity(exactInspectorState));
for (const [field, value, pattern] of [
  ['effectiveRoute', 'fallback/route', /effective route mismatch/],
  ['sourceHash', 'wrong-source', /source hash mismatch/],
  ['registrationHash', 'wrong-registration', /registration hash mismatch/],
  ['effectiveAmplitude', 0.24, /effective amplitude mismatch/],
  ['denseMotion', { status: 'missing' }, /dense motion did not mount/],
]) {
  assert.throws(() => assertInspectorIdentity({ ...exactInspectorState, [field]: value }), pattern);
}
const completeFrames = Array.from({ length: 72 }, (_, index) => ({ view: 'profile', index }));
assert.equal(assertCapturedFrameSet(completeFrames, 'profile', 72).length, 72);
assert.throws(
  () => assertCapturedFrameSet(completeFrames.slice(0, -1), 'profile', 72),
  /captured frame count mismatch/,
  'partial dense capture must fail',
);

const staleRoot = await mkdtemp(path.join(tmpdir(), 'lirm-motion-stale-'));
try {
  await writeFile(path.join(staleRoot, 'frame-999.png'), occupied);
  await prepareFrameDirectory(staleRoot);
  assert.deepEqual(await readdir(staleRoot), [], 'frame preparation must remove stale capture files');
} finally {
  await rm(staleRoot, { recursive: true, force: true });
}

const artifactRoot = new URL('../artifacts/lirm-719024-smooth-fitted-proxy-rig-motion-witness-v0/', import.meta.url);
assert.equal(existsSync(new URL('.chrome-profile/', artifactRoot)), false, 'runtime Chrome profile must not enter durable evidence');
const admission = JSON.parse(await readFile(new URL('visual-admission.json', artifactRoot), 'utf8'));
assert.equal(admission.denseWitness.captureReport, 'capture-report.json');
assert.equal(admission.denseWitness.requestedRoute, admission.identity.effectiveRoute);
assert.equal(admission.denseWitness.effectiveRoute, admission.identity.effectiveRoute);
const captureReport = JSON.parse(await readFile(new URL(admission.denseWitness.captureReport, artifactRoot), 'utf8'));
assert.equal(captureReport.status, 'captured-uninspected');
assert.equal(captureReport.failurePhase, null);
assert.equal(captureReport.requestedRoute, admission.identity.effectiveRoute);
assert.equal(captureReport.effectiveRoute, admission.identity.effectiveRoute);
assert.equal(captureReport.effectiveAmplitude, admission.identity.amplitude);
assert.equal(captureReport.capturedFrames.length, 144);
assert.deepEqual(captureReport.effectiveConfig.views, ['profile', 'three-quarter']);
assert.equal(captureReport.effectiveConfig.frameCount, 72);
for (const frame of captureReport.capturedFrames) {
  assert.equal(path.isAbsolute(frame.path), false, `${frame.id} path must be artifact-relative`);
  const frameUrl = new URL(frame.path, artifactRoot);
  const bytes = await readFile(frameUrl);
  assert.equal((await stat(frameUrl)).size, frame.bytes, `${frame.id} byte count must bind`);
  assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, frame.sha256, `${frame.id} hash must bind`);
}
for (const output of Object.values(captureReport.outputs)) {
  assert.equal(path.isAbsolute(output.frameRoot), false, 'frame root must be artifact-relative');
  assert.equal(path.isAbsolute(output.video.path), false, 'video path must be artifact-relative');
  assert.equal(path.isAbsolute(output.sheet.path), false, 'contact sheet path must be artifact-relative');
  const sheetBytes = await readFile(new URL(output.sheet.path, artifactRoot));
  assert.equal((await stat(new URL(output.sheet.path, artifactRoot))).size, output.sheet.bytes, 'contact sheet byte count must bind');
  assert.equal(`sha256:${createHash('sha256').update(sheetBytes).digest('hex')}`, output.sheet.sha256, 'contact sheet hash must bind');
}
for (const evidence of admission.denseWitness.evidence) {
  const bytes = await readFile(new URL(evidence.path, artifactRoot));
  assert.equal((await stat(new URL(evidence.path, artifactRoot))).size, evidence.bytes, `${evidence.path} byte count must bind`);
  assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, evidence.sha256, `${evidence.path} hash must bind`);
}

process.stdout.write(`${JSON.stringify({ status: 'passed', script: 'lirm-smooth-fitted-proxy-rig-motion-witness.mjs' }, null, 2)}\n`);
