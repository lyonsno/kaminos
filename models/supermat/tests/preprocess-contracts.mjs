import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleUrl = new URL('../supermat-preprocess.js', import.meta.url);
const api = fs.existsSync(moduleUrl) ? await import(moduleUrl) : {};
assert.equal(typeof api.resizeRgbaBilinear, 'function',
  'SuperMat preprocessing must reproduce Pillow RGBA BILINEAR resize');
assert.equal(typeof api.compositeOnGray, 'function',
  'SuperMat preprocessing must reproduce the source float32 gray composite');

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/preprocess-cases.json', import.meta.url), 'utf8'));
assert.equal(fixture.schema, 'supermat.preprocess-cases.v0');
const bytes = text => new Uint8Array(Buffer.from(text, 'base64'));
for (const item of fixture.cases) {
  const source = { width: item.width, height: item.height, data: bytes(item.rgba) };
  const resized = api.resizeRgbaBilinear(source, item.targetWidth, item.targetHeight);
  assert.equal(resized.width, item.targetWidth);
  assert.equal(resized.height, item.targetHeight);
  const expected = bytes(item.resized);
  const mismatches = resized.data.reduce((count, value, index) => count + (value !== expected[index]), 0);
  assert.equal(mismatches, 0, `${item.name}: resized RGBA must match Pillow exactly`);

  const composite = api.compositeOnGray(resized);
  const reference = new Float32Array(new Uint8Array(bytes(item.composite)).buffer);
  assert.equal(composite.length, reference.length, `${item.name}: CHW composite length`);
  const differing = composite.reduce((count, value, index) => count + !Object.is(value, reference[index]), 0);
  assert.equal(differing, 0, `${item.name}: composite must match the source float32 arithmetic exactly`);
}

assert.throws(() => api.resizeRgbaBilinear({ width: 2, height: 2, data: new Uint8Array(15) }, 1, 1), /RGBA/);
assert.throws(() => api.resizeRgbaBilinear({ width: 2, height: 2, data: new Uint8Array(16) }, 0, 1), /positive/);
console.log(`preprocess contracts passed (${fixture.cases.length} Pillow ${fixture.pillow} cases)`);
