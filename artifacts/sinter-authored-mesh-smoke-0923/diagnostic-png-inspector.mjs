import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

export function inspectPng(bytes) {
  assert.equal(bytes.readUInt32BE(0), 0x89504e47, 'visual capture is not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let sawEnd = false;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end + 4 <= bytes.length, `PNG ${type} chunk is truncated`);
    if (type === 'IHDR') {
      assert.equal(length, 13, 'PNG header must be complete');
      width = bytes.readUInt32BE(start);
      height = bytes.readUInt32BE(start + 4);
      assert.equal(bytes[start + 8], 8, 'PNG must use 8-bit channels');
      channels = bytes[start + 9] === 6 ? 4 : bytes[start + 9] === 2 ? 3 : 0;
      assert.ok(channels, `unsupported PNG color type ${bytes[start + 9]}`);
      assert.equal(bytes[start + 12], 0, 'interlaced PNG is not supported by this witness');
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(start, end));
    } else if (type === 'IEND') {
      assert.equal(length, 0, 'PNG end chunk must be empty');
      sawEnd = true;
      offset = end + 4;
      break;
    }
    offset = end + 4;
  }
  assert.ok(width > 0 && height > 0 && channels > 0 && idat.length > 0 && sawEnd && offset === bytes.length, 'PNG stream is incomplete');
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, height * (rowBytes + 1), 'PNG decoded pixel stream has the wrong size');
  let previous = Buffer.alloc(rowBytes);
  const reference = [0, 0, 0];
  let pixelIndex = 0;
  let activePixels = 0;
  const colors = new Set();
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1);
    const filter = raw[rowOffset];
    assert.ok(filter <= 4, `PNG row uses unsupported filter ${filter}`);
    const row = Buffer.from(raw.subarray(rowOffset + 1, rowOffset + rowBytes + 1));
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + predictor) & 255;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const base = x * channels;
      const rgb = [row[base], row[base + 1], row[base + 2]];
      if (pixelIndex === 0) reference.splice(0, 3, ...rgb);
      if (rgb.some((value, channel) => Math.abs(value - reference[channel]) >= 12)) activePixels += 1;
      if (colors.size < 257) colors.add(rgb.join(','));
      pixelIndex += 1;
    }
    previous = row;
  }
  return { width, height, activePixels, distinctSampledColors: colors.size, referenceColor: reference };
}

export function assertNonBlankCanvasScreenshot(metrics) {
  assert.ok(metrics.width > 0 && metrics.height > 0, 'canvas screenshot has no pixels');
  assert.ok(metrics.activePixels >= 100, 'canvas screenshot is visually blank or uniform');
  assert.ok(metrics.distinctSampledColors >= 8, 'canvas screenshot lacks spatially varying rendered pixels');
  return metrics;
}
