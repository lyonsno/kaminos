import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import {
  captureSourceShapedK4ProfileComparison,
  validateBrowserCompletion,
  validatePng,
  validateWitnessDom,
} from '../tools/capture-source-shaped-k4-profile-comparison.mjs';

const TOOL = path.resolve(
  new URL('../tools/capture-source-shaped-k4-profile-comparison.mjs', import.meta.url).pathname,
);
const SHA = 'a'.repeat(64);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function solidRgbPng(width, height, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const resolvedPixel = typeof pixel === 'function' ? pixel(x, y) : pixel;
      const offset = 1 + x * 3;
      row[offset] = resolvedPixel[0];
      row[offset + 1] = resolvedPixel[1];
      row[offset + 2] = resolvedPixel[2];
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('profile capture accepts only the exact loaded viewer state', () => {
  const exact = `<html data-requested-route="source-shaped-k4-packing-visual-v0"
    data-effective-route="source-shaped-k4-packing-visual-v0"
    data-fallback-used="false" data-profile="belly" data-condition="moderate"
    data-state="packed" data-witness-loaded="true" data-result-sha256="${SHA}"></html>`;
  assert.doesNotThrow(() => validateWitnessDom(exact, {
    profile: 'belly',
    condition: 'moderate',
    state: 'packed',
    resultSha256: SHA,
  }));
  assert.throws(
    () => validateWitnessDom(exact.replace('data-witness-loaded="true"', ''), {
      profile: 'belly', condition: 'moderate', state: 'packed', resultSha256: SHA,
    }),
    /witness-loaded/i,
  );
  assert.throws(
    () => validateWitnessDom(exact.replace('data-profile="belly"', 'data-profile="tube"'), {
      profile: 'belly', condition: 'moderate', state: 'packed', resultSha256: SHA,
    }),
    /profile.*belly/i,
  );
  assert.throws(
    () => validateWitnessDom(exact.replace(SHA, 'b'.repeat(64)), {
      profile: 'belly', condition: 'moderate', state: 'packed', resultSha256: SHA,
    }),
    /result.*sha/i,
  );
});

test('browser completion distinguishes validated post-output timeout candidates', () => {
  const timeout = new Error('spawnSync browser ETIMEDOUT');
  timeout.code = 'ETIMEDOUT';
  assert.deepEqual(validateBrowserCompletion({
    error: timeout,
    status: 0,
    signal: null,
  }), {
    kind: 'post-output-timeout-candidate',
    exitStatus: 0,
    signal: null,
    errorCode: 'ETIMEDOUT',
    error: 'spawnSync browser ETIMEDOUT',
  });
  assert.throws(
    () => validateBrowserCompletion({ error: timeout, status: null, signal: 'SIGTERM' }),
    /browser capture failed/i,
  );
});

test('profile capture writes a durable failure report before any screenshot exists', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'kaminos-profile-capture-failure-'));
  const result = spawnSync(process.execPath, [
    TOOL,
    '--browser', '/usr/bin/false',
    '--url', 'http://127.0.0.1:1/unreachable',
    '--output-dir', outputDirectory,
    '--tube-sha', SHA,
    '--belly-sha', 'b'.repeat(64),
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(await readFile(path.join(outputDirectory, 'capture-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.primaryOutput, null);
  assert.match(report.failurePhase, /capture/i);
  assert.equal(report.lastTrustworthyEvidence.phase, 'browser-identity-bound');
  assert.equal(report.requestedProfiles.belly.resultSha256, 'b'.repeat(64));
});

test('profile capture rejects a structurally valid same-size blank scene', () => {
  const blank = solidRgbPng(1400, 900, [8, 11, 16]);
  assert.throws(
    () => validatePng(blank, { width: 1400, height: 900 }),
    /scene pixels|blank|visual/i,
  );
});

test('profile capture rejects a structurally valid UI-only frame', () => {
  const uiOnly = solidRgbPng(1400, 900, (x, y) =>
    x < 421 && y < 560 ? [147, 200, 255] : [8, 11, 16]);
  assert.throws(
    () => validatePng(uiOnly, { width: 1400, height: 900 }),
    /scene pixels|UI-only|partial/i,
  );
});

test('profile capture records stable scene-region evidence for a real K4 frame', async () => {
  const frame = await readFile(new URL(
    '../artifacts/source-shaped-k4-packing-profile-comparison-v0/belly-baseline-packed.png',
    import.meta.url,
  ));
  const validated = validatePng(frame, { width: 1400, height: 900 });
  assert.match(validated.pixelEvidence.sceneRegionSha256, /^[0-9a-f]{64}$/);
  assert.ok(validated.pixelEvidence.occupiedPixelCount > 100_000);
  assert.deepEqual(validated.pixelEvidence.activeColorFamilies, ['warm', 'cyan', 'purple']);
});

test('resume refuses a prior capture ledger from a different viewer URL', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'kaminos-profile-resume-route-'));
  const priorReportPath = path.join(outputDirectory, 'prior-report.json');
  await writeFile(priorReportPath, `${JSON.stringify({
    schema: 'kaminos.source-shaped-k4-profile-comparison-capture.v1',
    status: 'in-progress',
    route: {
      requested: 'chromium-virtual-time-dom-and-scene-pixel-verified-screenshot-v1',
      effective: 'chromium-virtual-time-dom-and-scene-pixel-verified-screenshot-v1',
      fallbackUsed: false,
    },
    viewerRoute: {
      requested: 'source-shaped-k4-packing-visual-v0',
      effective: 'source-shaped-k4-packing-visual-v0',
      fallbackUsed: false,
    },
    invocation: {
      baseUrl: 'http://127.0.0.1:8766/old-viewer/index.html',
      viewport: { width: 1400, height: 900 },
    },
    requestedProfiles: {
      tube: { resultSha256: SHA },
      belly: { resultSha256: 'b'.repeat(64) },
    },
    captures: [],
  }, null, 2)}\n`);
  assert.throws(
    () => captureSourceShapedK4ProfileComparison({
      browserExecutable: '/usr/bin/false',
      baseUrl: 'http://127.0.0.1:8766/new-viewer/index.html',
      outputDirectory,
      reportPath: path.join(outputDirectory, 'current-report.json'),
      tubeSha256: SHA,
      bellySha256: 'b'.repeat(64),
      maxCaptureAttempts: 1,
      resumeReportPath: priorReportPath,
    }),
    /resume report base URL/i,
  );
});

test('resume refuses a capture URL that does not match its current slot', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'kaminos-profile-resume-slot-'));
  const priorReportPath = path.join(outputDirectory, 'prior-report.json');
  const baseUrl = 'http://127.0.0.1:8766/viewer/index.html';
  await writeFile(priorReportPath, `${JSON.stringify({
    schema: 'kaminos.source-shaped-k4-profile-comparison-capture.v1',
    status: 'in-progress',
    route: {
      requested: 'chromium-virtual-time-dom-and-scene-pixel-verified-screenshot-v1',
      effective: 'chromium-virtual-time-dom-and-scene-pixel-verified-screenshot-v1',
      fallbackUsed: false,
    },
    viewerRoute: {
      requested: 'source-shaped-k4-packing-visual-v0',
      effective: 'source-shaped-k4-packing-visual-v0',
      fallbackUsed: false,
    },
    invocation: { baseUrl, viewport: { width: 1400, height: 900 } },
    requestedProfiles: {
      tube: { resultSha256: SHA },
      belly: { resultSha256: 'b'.repeat(64) },
    },
    captures: [{
      profile: 'tube',
      condition: 'baseline',
      state: 'before',
      url: `${baseUrl}?profile=belly&condition=moderate&state=packed`,
      output: 'tube-baseline-before.png',
      sha256: SHA,
      domIdentity: {},
    }],
  }, null, 2)}\n`);
  assert.throws(
    () => captureSourceShapedK4ProfileComparison({
      browserExecutable: '/usr/bin/false',
      baseUrl,
      outputDirectory,
      reportPath: path.join(outputDirectory, 'current-report.json'),
      tubeSha256: SHA,
      bellySha256: 'b'.repeat(64),
      maxCaptureAttempts: 1,
      resumeReportPath: priorReportPath,
    }),
    /resume capture URL mismatch/i,
  );
});
