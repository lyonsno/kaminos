import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

export function measureBoundarySplatTemporalFrame(buffer) {
  const png = parsePngRgba(buffer);
  const xStart = Math.floor(png.width * 0.02);
  const xEnd = Math.floor(png.width * 0.98);
  const yStart = Math.floor(png.height * 0.02);
  const yEnd = Math.floor(png.height * 0.98);
  let litPixels = 0;
  let totalPixels = 0;
  let minX = png.width;
  let maxX = -1;
  let minY = png.height;
  let maxY = -1;
  let weightedY = 0;

  for (let y = yStart; y < yEnd; y += 2) {
    const row = png.rows[y];
    for (let x = xStart; x < xEnd; x += 2) {
      const offset = x * png.channels;
      const red = row[offset];
      const green = row[offset + 1];
      const blue = row[offset + 2];
      const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      totalPixels += 1;
      if (luma < 42 || (chroma < 12 && luma < 105)) continue;
      litPixels += 1;
      weightedY += y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const litWidth = maxX >= minX ? maxX - minX + 2 : 0;
  const litHeight = maxY >= minY ? maxY - minY + 2 : 0;
  const litWidthRatio = png.width ? litWidth / png.width : 0;
  const litHeightRatio = png.height ? litHeight / png.height : 0;
  const litDensity = totalPixels ? litPixels / totalPixels : 0;
  const litBoundsAreaRatio = litWidthRatio * litHeightRatio;
  return {
    width: png.width,
    height: png.height,
    sampledPixels: totalPixels,
    litPixels,
    litDensity,
    litBounds: litPixels ? { minX, maxX, minY, maxY } : null,
    litWidthRatio,
    litHeightRatio,
    litAspectRatio: litHeight ? litWidth / litHeight : 0,
    litFillRatio: litBoundsAreaRatio ? litDensity / litBoundsAreaRatio : 0,
    litCentroidYRatio: litPixels && png.height ? (weightedY / litPixels) / png.height : null,
  };
}

export function summarizeBoundarySplatTemporalCollapse(samples) {
  if (!Array.isArray(samples) || samples.length < 3) {
    throw new Error('boundary-splat-temporal-collapse-at-least-three-samples-required');
  }
  const scored = samples.map((sample, position) => {
    const metrics = sample?.metrics || {};
    const width = finiteNonnegative(metrics.litWidthRatio);
    const height = Math.max(0.001, finiteNonnegative(metrics.litHeightRatio));
    const density = finiteNonnegative(metrics.litDensity);
    const fill = Number.isFinite(Number(metrics.litFillRatio))
      ? finiteNonnegative(metrics.litFillRatio)
      : density / Math.max(0.001, width * height);
    const collapseScore = fill * Math.sqrt(density);
    return {
      position,
      sampleIndex: Number.isInteger(sample?.index) ? sample.index : position,
      frameCount: finiteOrNull(sample?.frameCount),
      historyWriteSlot: finiteOrNull(sample?.historyWriteSlot),
      collapseScore,
      litWidthRatio: width,
      litHeightRatio: height,
      litDensity: density,
      litFillRatio: fill,
    };
  });
  const scores = scored.map(sample => sample.collapseScore);
  const medianCollapseScore = median(scores);
  const medianHeightRatio = median(scored.map(sample => sample.litHeightRatio));
  const medianDensity = median(scored.map(sample => sample.litDensity));
  const medianFillRatio = median(scored.map(sample => sample.litFillRatio));
  const worst = scored.reduce((current, sample) => (
    sample.collapseScore > current.collapseScore ? sample : current
  ));
  const candidateThreshold = medianCollapseScore * 1.35;
  const candidatePositions = scored
    .filter(sample => sample.collapseScore >= candidateThreshold)
    .map(sample => sample.position);
  const intervalPositions = [worst.position - 1, worst.position, worst.position + 1]
    .filter(position => position >= 0 && position < samples.length);
  const slotCounts = new Map();
  for (const position of candidatePositions) {
    const slot = scored[position].historyWriteSlot;
    if (slot == null) continue;
    slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
  }
  const dominantSlotEntry = [...slotCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const dominantSlotFraction = dominantSlotEntry && candidatePositions.length
    ? dominantSlotEntry[1] / candidatePositions.length
    : 0;
  const classification = candidatePositions.length
    ? 'candidate-temporal-collapse'
    : 'no-relative-collapse-candidate';
  const phaseCorrelation = !candidatePositions.length
    ? 'no-collapse-candidate'
    : candidatePositions.length >= 2 && dominantSlotFraction >= 0.6
      ? 'write-slot-correlated-candidate'
      : 'source-window-or-view-correlated-candidate';

  return {
    identity: 'boundary-splat-temporal-collapse-summary-v0',
    authority: 'full-sequence-relative-image-geometry-plus-live-phase-telemetry-v0',
    sampleCount: samples.length,
    classification,
    phaseCorrelation,
    medianCollapseScore,
    medianHeightRatio,
    medianDensity,
    medianFillRatio,
    worstCollapseScore: worst.collapseScore,
    worstSampleIndex: worst.sampleIndex,
    worstFrameCount: worst.frameCount,
    worstHistoryWriteSlot: worst.historyWriteSlot,
    worstIntervalSampleIndices: intervalPositions.map(position => scored[position].sampleIndex),
    candidateSampleIndices: candidatePositions.map(position => scored[position].sampleIndex),
    candidateCount: candidatePositions.length,
    dominantCandidateHistoryWriteSlot: dominantSlotEntry?.[0] ?? null,
    dominantCandidateHistoryWriteSlotFraction: dominantSlotFraction,
    scoredSamples: scored,
    claimBoundary: 'candidate ranking for operator and frame-sequence inspection; not autonomous visual closure',
  };
}

function finiteNonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8, 'only 8-bit PNG screenshots are supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let pointer = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pointer++];
    const row = Buffer.from(raw.subarray(pointer, pointer + stride));
    pointer += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= channels ? previous[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    }
    rows.push(row);
    previous = row;
  }
  return { width, height, channels, rows };
}
