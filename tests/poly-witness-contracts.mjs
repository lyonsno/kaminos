// kaminos-test: node
// The polygon witness must fail loud instead of letting thin output pass as evidence.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { MIN_SAMPLED_COLOURS, addressMismatch, decodePng, pngStats, subsetMismatch } from '../tools/poly-witness.mjs';

// Rows cycle through all five PNG filters, as a browser's encoder chooses them per row.
function png(width, height, pixel) {
  const crc = buffer => { let c = ~0; for (const byte of buffer) { c ^= byte; for (let k = 0; k < 8; k++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return ~c >>> 0; };
  const chunk = (kind, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(kind, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const stride = 3 * width, pixels = Buffer.alloc(stride * height), raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(pixel(x, y), y * stride + 3 * x);
  for (let y = 0; y < height; y++) {
    const filter = y % 5; raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const r = pixels[y * stride + x], a = x >= 3 ? pixels[y * stride + x - 3] : 0, b = y ? pixels[(y - 1) * stride + x] : 0, c = y && x >= 3 ? pixels[(y - 1) * stride + x - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      raw[y * (stride + 1) + 1 + x] = (r - [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
  }
  return { png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]), pixels };
}

const gradientImage = png(256, 192, (x, y) => [x, y, (x * y) & 255]);
assert.ok(decodePng(gradientImage.png).pixels.equals(gradientImage.pixels), 'every filter type decodes to the exact source pixels');
const flat = pngStats(png(256, 192, () => [12, 14, 18]).png);
assert.equal(flat.sampledDistinctColours, 1);
assert.ok(flat.sampledDistinctColours < MIN_SAMPLED_COLOURS, 'a blank viewport is rejected');
const gradient = pngStats(gradientImage.png);
assert.deepEqual([gradient.width, gradient.height], [256, 192]);
assert.ok(gradient.sampledDistinctColours >= MIN_SAMPLED_COLOURS, 'a frame with real content passes');
assert.throws(() => pngStats(Buffer.from('not a png at all')), /PNG/);

assert.equal(subsetMismatch({ sharpAngle: 60, census: { vertices: 34125, faces: 94583 } }, { sharpAngle: 60, census: { vertices: 34125 } }), null);
assert.match(subsetMismatch({ sharpAngle: 30 }, { sharpAngle: 60 }), /sharpAngle: expected 60, got 30/, 'a defaulted setting is caught');
assert.match(subsetMismatch({ census: { vertices: 138656 } }, { census: { vertices: 34125 } }), /census\.vertices/, 'an unwelded fallback is caught');
assert.match(subsetMismatch(undefined, { source: '/api/read?root=greenroom' }), /source/);
assert.equal(subsetMismatch({ target: [0, .25, 0.36999999999999994] }, { target: [0, .25, { $near: .37 }] }), null, 'an opted-in camera value tolerates float round-trip');
assert.match(subsetMismatch({ target: [0, .25, .3701] }, { target: [0, .25, { $near: .37 }] }), /within/, 'but not a different view');
assert.match(subsetMismatch({ count: '4' }, { count: { $near: 4 } }), /within/, 'and never a non-number');
assert.match(subsetMismatch({ target: [0, .25, 0.36999999999999994] }, { target: [0, .25, .37] }), /expected 0.37/, 'exact stays exact unless opted in');

const page = 'http://127.0.0.1:8090/index.html?workspace=workbench&experiment=poly-edge-census&experiment_inputs=' + encodeURIComponent('{"url":"/a.glb","sharpAngle":60}');
assert.equal(addressMismatch(page, 'http://127.0.0.1:8090/index.html?workspace=workbench&experiment=poly-edge-census&experiment_inputs=%7B%22url%22%3A%22%2Fa.glb%22%2C%22sharpAngle%22%3A60%7D'), null, 're-serialized but identical inputs pass');
assert.match(addressMismatch(page, page.replace('60', '30')), /inputs changed/, 'a page that swaps its inputs is caught');
assert.match(addressMismatch(page, 'http://127.0.0.1:8090/index.html?experiment=poly-edge-census&experiment_inputs=' + encodeURIComponent('{"url":"/a.glb","sharpAngle":60}')), /dropped workspace/);
assert.match(addressMismatch(page, page.replace(':8090', ':8091')), /not the requested/, 'another server is not this route');

const tool = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'poly-witness.mjs');
const work = mkdtempSync(join(tmpdir(), 'poly-witness-contract-'));
writeFileSync(join(work, 'steps.json'), '[]');
const run = (chrome, out) => {
  const env = { ...process.env }; delete env.KAMINOS_CHROME; if (chrome) env.KAMINOS_CHROME = chrome;
  const result = spawnSync(process.execPath, [tool, '--url', 'http://127.0.0.1:1/index.html?experiment=poly-edge-census', '--out', out, '--steps', join(work, 'steps.json')], { env, encoding: 'utf8', timeout: 30000 });
  return { status: result.status, report: JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) };
};
const missing = run(null, join(work, 'missing'));
assert.equal(missing.status, 1);
assert.equal(missing.report.failure.phase, 'launching-browser', 'no browser means a durable failure report, not silence');
assert.equal(missing.report.browser, null);
const fakeOperatorChrome = join(work, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
mkdirSync(dirname(fakeOperatorChrome), { recursive: true }); writeFileSync(fakeOperatorChrome, '');
const operator = run(fakeOperatorChrome, join(work, 'operator'));
assert.equal(operator.status, 1);
assert.match(operator.report.failure.message, /independent browser/, "the operator's own Chrome is never driven headlessly");
