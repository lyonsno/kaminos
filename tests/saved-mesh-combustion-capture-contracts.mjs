import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
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

console.log('saved mesh combustion capture contracts: ok');
