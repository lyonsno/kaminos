import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { CDP_REQUEST_TIMEOUT_MS, cdpRequest } from '../artifacts/sinter-authored-mesh-smoke-0923/diagnostic-cdp.mjs';
import { assertNonBlankCanvasScreenshot, inspectPng } from '../artifacts/sinter-authored-mesh-smoke-0923/diagnostic-png-inspector.mjs';

const capturePath = resolve(process.argv[2] || new URL('../artifacts/sinter-authored-mesh-smoke-0923/diagnostic-capture-r3.mjs', import.meta.url).pathname);
const capture = readFileSync(capturePath, 'utf8');
const requirePattern = (pattern, message) => assert.ok(pattern.test(capture), message);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function rgbaPng(width, height, pixelAt) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) Buffer.from(pixelAt(x, y)).copy(row, 1 + x * 4);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const blankCanvas = inspectPng(rgbaPng(16, 16, () => [0, 0, 0, 255]));
assert.equal(blankCanvas.activePixels, 0, 'uniform canvas pixels must decode as blank');
assert.throws(() => assertNonBlankCanvasScreenshot(blankCanvas), /blank or uniform/, 'blank rendered output must fail the visual evidence gate');
const varyingCanvas = assertNonBlankCanvasScreenshot(inspectPng(rgbaPng(16, 16, (x, y) => [x * 17, y * 17, (x + y) * 8, 255])));
assert.ok(varyingCanvas.activePixels >= 100, 'visible varied canvas fixture must pass the pixel gate');
assert.throws(() => inspectPng(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), /incomplete|truncated/, 'partial screenshot bytes must not close the visual evidence gate');

requirePattern(/live-volume-ready-before-scene-load/, 'capture must wait for live volume initialization before loading the saved scene');
requirePattern(/backend === 'WebGPU:apple'/, 'capture must reject a fallback or unexpected renderer backend');
requirePattern(/effectiveRoute === 'native-3d-compute-fluid-raymarch-v0'/, 'capture must reject an unexpected volume route');
requirePattern(/Number\(lastRuntimeState\.simGrid\) === 96/, 'capture must keep the requested 96-cubed simulation grid');
requirePattern(/route\.searchParams\.set\('volume_resolution', '96'\)/, 'the requested grid must be explicit in the effective route');
requirePattern(/assert\.equal\(loaded\.fileName, 'sinter-forked-timber-combustion\.kaminos\.json'/, 'capture must load the named saved scene');
requirePattern(/expectedAssetIdentity: 'sha256:1270054ee62bd3c5c688b13e7334f9ae99280f5868b2121fd317b4dffe5d2b84'/, 'capture must pin the authored trestle asset identity');
requirePattern(/report\.injectedScenePayloadSha256 = sha256\(Buffer\.from\(sceneLiteral, 'utf8'\)\)/, 'capture must hash the exact scene payload loaded into the browser');
requirePattern(/currentSource\?\.sameDevice === true/, 'GPU scene source and combustion assembly must share device identity');
requirePattern(/currentAssembly\?\.dispatchCount >= 120[\s\S]*?currentAssembly\?\.presentationCount >= 120/, 'capture must observe actual simulation and presentation dispatches');
requirePattern(/currentAssembly\?\.meshTriangleCount === 864[\s\S]*?meshAssetIdentities\?\.includes\(report\.expectedAssetIdentity\)/, 'capture must match the exact trestle geometry and asset');
requirePattern(/assert\.equal\(assembly\.runtimeReadbackCount, 0, 'GPU diagnostic introduced host material readback'/, 'the visual assay must retain its GPU-only material boundary');
requirePattern(/assertNonBlankCanvasScreenshot\(inspectPng\(canvasImageBytes\)\)/, 'capture must reject blank canvas pixels after decoding its screenshot');
requirePattern(/dispatches from the exact saved trestle assembly`, 180000\)/, 'the corrected startup path must leave time for asynchronous scene assembly');
requirePattern(/failureContext = \{[\s\S]*?lastRuntimeState,[\s\S]*?pageErrors:/, 'a failed capture must preserve runtime state and page errors');
requirePattern(/if \(report\.status !== 'passed'\) process\.exitCode = 1/, 'capture failure must produce a failing process exit');
requirePattern(/cdpRequest \} from '\.\/diagnostic-cdp\.mjs'/, 'the capture must use bounded DevTools requests');
requirePattern(/visualStatus: 'inspection-required'/, 'capture success must not claim visible trestle diagnostics before image inspection');
requirePattern(/statusScope: 'capture-and-runtime-only'/, 'capture pass status must be limited to route and runtime integrity');
requirePattern(/report\.visualStatus = 'inspection-required'/, 'each successful capture must preserve the manual trestle-pixel inspection gate');
requirePattern(/finally \{[\s\S]*?saveReport\(\)/, 'every handled failure must persist a terminal report');

class FakeSocket extends EventTarget {
  send(payload) {
    this.request = JSON.parse(payload);
  }
}

assert.equal(CDP_REQUEST_TIMEOUT_MS, 180_000, 'production DevTools calls must have a deadline that allows the asynchronous capture path');
const timedOutSocket = new FakeSocket();
await assert.rejects(cdpRequest(timedOutSocket, 'Runtime.evaluate', {}, 5), /reply timed out after 5ms/, 'a missing DevTools reply must reject and release the capture failure path');
const closingSocket = new FakeSocket();
const closingRequest = cdpRequest(closingSocket, 'Page.captureScreenshot', {}, 5000);
closingSocket.dispatchEvent(new Event('close'));
await assert.rejects(closingRequest, /socket closed before a reply/, 'DevTools socket closure must reject an in-flight capture request');
const respondingSocket = new FakeSocket();
const respondingRequest = cdpRequest(respondingSocket, 'Runtime.evaluate', {}, 5000);
const response = new Event('message');
Object.defineProperty(response, 'data', { value: JSON.stringify({ id: 1, result: { value: 'ok' } }) });
respondingSocket.dispatchEvent(response);
assert.deepEqual(await respondingRequest, { value: 'ok' }, 'matching DevTools replies must still resolve normally');

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-capture-launch-failure-'));
try {
  const launchFailure = spawnSync(process.execPath, [
    capturePath,
    '--repo-root', resolve(fileURLToPath(new URL('..', import.meta.url))),
    '--scene', resolve(fileURLToPath(new URL('../scenes/sinter-forked-timber-combustion.kaminos.json', import.meta.url))),
    '--origin', 'http://127.0.0.1:8094',
    '--out-dir', join(failureRoot, 'output'),
  ], {
    encoding: 'utf8',
    env: { ...process.env, KAMINOS_CHROME: join(failureRoot, 'missing-chrome') },
  });
  assert.equal(launchFailure.status, 1, 'an invalid Chrome executable must fail the capture command');
  const failedReport = JSON.parse(readFileSync(join(failureRoot, 'output/report.json'), 'utf8'));
  if (failedReport.browser?.profile) rmSync(failedReport.browser.profile, { recursive: true, force: true });
  assert.equal(failedReport.status, 'failed', 'a Chrome spawn failure must not leave a running report');
  assert.equal(failedReport.phase, 'browser-launch', 'the terminal report must identify the browser-launch failure phase');
  assert.equal(failedReport.failureContext.phase, 'browser-launch');
  assert.equal(failedReport.failureContext.lastRuntimeState, null, 'the failure report must preserve that no live runtime state was observed');
  assert.equal(failedReport.failureContext.lastTrustedEvidence, null, 'the failure report must preserve the last trustworthy stage');
  assert.match(failedReport.errors.join('\n'), /ENOENT|no such file|not found/i, 'the failed executable must remain diagnosable');
} finally {
  rmSync(failureRoot, { recursive: true, force: true });
}

console.log('saved mesh combustion capture contracts: ok');
