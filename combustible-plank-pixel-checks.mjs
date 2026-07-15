import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const estimate = a + b - c;
  const distanceA = Math.abs(estimate - a);
  const distanceB = Math.abs(estimate - b);
  const distanceC = Math.abs(estimate - c);
  if (distanceA <= distanceB && distanceA <= distanceC) return a;
  return distanceB <= distanceC ? b : c;
}

export function decodePng(png) {
  const bytes = Buffer.from(png);
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'pixel evidence is not a PNG');
  let offset = 8;
  let width = null;
  let height = null;
  let bitDepth = null;
  let colorType = null;
  let interlace = null;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= bytes.length, `truncated PNG chunk: ${type}`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      compressed.push(data);
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  assert.ok(width > 0 && height > 0, 'PNG dimensions are missing');
  assert.equal(bitDepth, 8, `unsupported PNG bit depth: ${bitDepth}`);
  assert.ok(colorType === 6 || colorType === 2, `unsupported PNG color type: ${colorType}`);
  assert.equal(interlace, 0, 'interlaced PNG evidence is unsupported');
  assert.ok(compressed.length > 0, 'PNG has no image data');

  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(compressed));
  assert.equal(inflated.length, (rowBytes + 1) * height, 'PNG scanline size does not match dimensions');
  const reconstructed = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * (rowBytes + 1);
    const targetRow = y * rowBytes;
    const filter = inflated[sourceRow];
    assert.ok(filter <= 4, `unsupported PNG row filter: ${filter}`);
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[sourceRow + 1 + x];
      const left = x >= channels ? reconstructed[targetRow + x - channels] : 0;
      const up = y > 0 ? reconstructed[targetRow - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= channels ? reconstructed[targetRow - rowBytes + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      reconstructed[targetRow + x] = (raw + predictor) & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    rgba[target] = reconstructed[source];
    rgba[target + 1] = reconstructed[source + 1];
    rgba[target + 2] = reconstructed[source + 2];
    rgba[target + 3] = channels === 4 ? reconstructed[source + 3] : 255;
  }
  return { width, height, rgba };
}

function analyzeDecoded(decoded, png) {
  const { width, height, rgba } = decoded;
  const totalPixels = width * height;
  const topLimit = Math.max(6, Math.floor(height * 0.10));
  const bottomStart = Math.floor(height * 0.92);
  const centerTop = Math.floor(height * 0.11);
  const centerBottom = Math.floor(height * 0.91);
  let woodPixels = 0;
  let woodEdgePixels = 0;
  let flamePixels = 0;
  let topTextPixels = 0;
  let bottomTextPixels = 0;
  let centerPixels = 0;
  let centerNearBlackPixels = 0;
  let woodMinX = width;
  let woodMaxX = -1;
  let woodMinY = height;
  let woodMaxY = -1;
  const quantizedColors = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = rgba[offset];
      const g = rgba[offset + 1];
      const b = rgba[offset + 2];
      const a = rgba[offset + 3];
      if ((x + y) % 4 === 0) quantizedColors.add(`${r >> 4}:${g >> 4}:${b >> 4}:${a >> 6}`);
      const neutralLight = a > 200 && Math.min(r, g, b) >= 150 && Math.max(r, g, b) - Math.min(r, g, b) <= 50;
      if (neutralLight && y < topLimit) topTextPixels += 1;
      if (neutralLight && y >= bottomStart) bottomTextPixels += 1;
      const wood = a > 200 && r >= 125 && r > g * 1.25 && g > b * 1.35 && g >= 55 && g <= 180;
      if (wood) {
        woodPixels += 1;
        if (x < 2 || x >= width - 2) woodEdgePixels += 1;
        woodMinX = Math.min(woodMinX, x);
        woodMaxX = Math.max(woodMaxX, x);
        woodMinY = Math.min(woodMinY, y);
        woodMaxY = Math.max(woodMaxY, y);
      }
      if (a > 200 && r >= 230 && g >= 145 && b <= 105) flamePixels += 1;
      if (y >= centerTop && y < centerBottom) {
        centerPixels += 1;
        if (r <= 10 && g <= 10 && b <= 10) centerNearBlackPixels += 1;
      }
    }
  }
  return {
    width,
    height,
    sha256: createHash('sha256').update(png).digest('hex'),
    totalPixels,
    quantizedColorCount: quantizedColors.size,
    woodPixels,
    woodEdgePixels,
    flamePixels,
    topTextPixels,
    bottomTextPixels,
    centerNearBlackRatio: centerPixels ? centerNearBlackPixels / centerPixels : 1,
    woodBounds: woodPixels ? { minX: woodMinX, maxX: woodMaxX, minY: woodMinY, maxY: woodMaxY } : null,
    decoded,
  };
}

function phaseDifference(left, right) {
  assert.equal(left.width, right.width, 'phase screenshots have different widths');
  assert.equal(left.height, right.height, 'phase screenshots have different heights');
  let changedPixels = 0;
  for (let offset = 0; offset < left.rgba.length; offset += 4) {
    const difference = Math.abs(left.rgba[offset] - right.rgba[offset]) +
      Math.abs(left.rgba[offset + 1] - right.rgba[offset + 1]) +
      Math.abs(left.rgba[offset + 2] - right.rgba[offset + 2]);
    if (difference > 60) changedPixels += 1;
  }
  return { changedPixels, changedRatio: changedPixels / (left.width * left.height) };
}

function publicPhase(phase) {
  const { decoded, ...record } = phase;
  return record;
}

export function validateWitnessPixelSequence(pngs) {
  const phases = Object.fromEntries(
    ['initial', 'combustion', 'final'].map(name => {
      const png = Buffer.from(pngs[name] || []);
      return [name, analyzeDecoded(decodePng(png), png)];
    }),
  );
  const result = {
    method: 'decoded-composed-png-phase-regions-v0',
    status: 'pending',
    phases: Object.fromEntries(Object.entries(phases).map(([name, phase]) => [name, publicPhase(phase)])),
    deltas: null,
  };
  try {
    const initialToCombustion = phaseDifference(phases.initial.decoded, phases.combustion.decoded);
    const initialToFinal = phaseDifference(phases.initial.decoded, phases.final.decoded);
    result.deltas = { initialToCombustion, initialToFinal };
    const minimumWood = Math.max(20, Math.floor(phases.initial.totalPixels * 0.004));
    const minimumText = Math.max(8, Math.floor(phases.initial.totalPixels * 0.00001));
    for (const [name, phase] of Object.entries(phases)) {
      assert.ok(phase.quantizedColorCount >= 3, `${name} visual is blank or color-degenerate`);
      assert.ok(phase.woodPixels >= minimumWood, `${name} visual does not contain a visible plank`);
      assert.ok(
        phase.woodEdgePixels <= Math.max(2, Math.floor(phase.totalPixels * 0.00002)),
        `${name} visual clips plank geometry at a horizontal edge`,
      );
      assert.ok(phase.topTextPixels >= minimumText, `${name} visual is missing composed top status text`);
      assert.ok(phase.bottomTextPixels >= minimumText, `${name} visual is missing composed ledger text`);
      assert.ok(phase.centerNearBlackRatio < 0.35, `${name} visual is blank or substantially occluded`);
    }
    const minimumFlameDelta = Math.max(4, Math.floor(phases.initial.totalPixels * 0.00001));
    assert.ok(
      phases.combustion.flamePixels >= phases.initial.flamePixels + minimumFlameDelta,
      'combustion visual does not contain a visible active-fire increase',
    );
    assert.notEqual(phases.initial.sha256, phases.combustion.sha256, 'combustion screenshot is stale');
    assert.notEqual(phases.initial.sha256, phases.final.sha256, 'fallen screenshot is stale');
    assert.ok(initialToCombustion.changedRatio > 0.0005, 'combustion visual lacks a material pixel delta');
    assert.ok(initialToFinal.changedRatio > 0.001, 'fallen visual lacks a material collapse delta');
    result.status = 'ok';
    return result;
  } catch (error) {
    result.status = 'failed';
    result.error = error?.message || String(error);
    error.pixelChecks = result;
    throw error;
  }
}
