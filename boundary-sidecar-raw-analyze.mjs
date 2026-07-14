#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const inputDir = resolve(args.get('--input-dir') || '.');
const outputDir = resolve(args.get('--output-dir') || join(inputDir, 'analysis'));
const outputReportPath = join(outputDir, 'analysis-report.json');
mkdirSync(outputDir, { recursive: true });

const report = {
  schema: 'boundary-sidecar-raw-analysis-report-v0',
  ok: false,
  failurePhase: 'load-metadata',
  inputDir,
  outputDir,
};

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function finiteStats(values, channelOffset, cellCount, transform = value => value) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let finiteCount = 0;
  let nonFiniteCount = 0;
  let nonZeroCount = 0;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const value = transform(values[cellIndex * 4 + channelOffset], cellIndex);
    if (!Number.isFinite(value)) {
      nonFiniteCount += 1;
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    finiteCount += 1;
    if (value !== 0) nonZeroCount += 1;
  }
  return {
    min: finiteCount ? min : null,
    max: finiteCount ? max : null,
    mean: finiteCount ? sum / finiteCount : null,
    finiteCount,
    nonFiniteCount,
    nonZeroCount,
    nonZeroFraction: cellCount ? nonZeroCount / cellCount : 0,
  };
}

function countNonFinite(values) {
  let nonFiniteCount = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) nonFiniteCount += 1;
  }
  return nonFiniteCount;
}

function normalMagnitude(metaValues, cellIndex) {
  const base = cellIndex * 4;
  return Math.hypot(metaValues[base + 1], metaValues[base + 2], metaValues[base + 3]);
}

const crcTable = new Uint32Array(256);
for (let tableIndex = 0; tableIndex < 256; tableIndex += 1) {
  let value = tableIndex;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  crcTable[tableIndex] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function encodeGrayscalePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const scanlines = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width + 1);
    scanlines[rowOffset] = 0;
    pixels.copy(scanlines, rowOffset + 1, y * width, (y + 1) * width);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND'),
  ]);
}

function writeZProjection({ name, values, channelOffset, grid, mode, transform = value => value }) {
  const [gridX, gridY, gridZ] = grid;
  const projected = new Float32Array(gridX * gridY);
  let projectionMax = 0;
  for (let y = 0; y < gridY; y += 1) {
    for (let x = 0; x < gridX; x += 1) {
      let projectedValue = 0;
      for (let z = 0; z < gridZ; z += 1) {
        const cellIndex = x + y * gridX + z * gridX * gridY;
        const value = transform(values[cellIndex * 4 + channelOffset], cellIndex);
        if (!Number.isFinite(value)) continue;
        projectedValue = mode === 'sum' ? projectedValue + Math.max(0, value) : Math.max(projectedValue, value);
      }
      projected[x + y * gridX] = projectedValue;
      projectionMax = Math.max(projectionMax, projectedValue);
    }
  }

  const pixels = Buffer.alloc(gridX * gridY);
  const scale = projectionMax > 0 ? 255 / projectionMax : 0;
  for (let y = 0; y < gridY; y += 1) {
    const displayY = gridY - 1 - y;
    for (let x = 0; x < gridX; x += 1) {
      const value = projected[x + y * gridX];
      pixels[x + displayY * gridX] = Math.round(Math.min(255, Math.max(0, value * scale)));
    }
  }
  const path = join(outputDir, `${name}-${mode}-z.png`);
  writeFileSync(path, encodeGrayscalePng(gridX, gridY, pixels));
  return {
    path,
    width: gridX,
    height: gridY,
    sourceMax: projectionMax,
    normalization: 'per-channel-max-to-255-v0',
    reducer: mode,
    worldYDisplay: 'up',
  };
}

try {
  const metadataPath = join(inputDir, 'metadata.json');
  const sourceReportPath = join(inputDir, 'report.json');
  const metadataBuffer = readFileSync(metadataPath);
  const sourceReportBuffer = readFileSync(sourceReportPath);
  const metadata = JSON.parse(metadataBuffer.toString('utf8'));
  const sourceReport = JSON.parse(sourceReportBuffer.toString('utf8'));
  if (metadata.job_type !== 'kaminos_boundary_sidecar_raw_export') {
    throw new Error(`unexpected Greenroom job type: ${metadata.job_type || 'missing'}`);
  }
  if (sourceReport.schema !== 'boundary-sidecar-raw-export-report-v0' || sourceReport.ok !== true) {
    throw new Error(`raw export report is not complete: schema=${sourceReport.schema || 'missing'} ok=${sourceReport.ok}`);
  }
  report.failurePhase = 'validate-source-authority';
  if (sourceReport.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') {
    throw new Error(`unexpected effective route: ${sourceReport.effectiveRoute || 'missing'}`);
  }
  if (sourceReport.fallbackReason !== null) {
    throw new Error(`raw export carries fallback reason: ${sourceReport.fallbackReason ?? 'missing'}`);
  }
  const capture = sourceReport.capture;
  if (capture?.identity !== 'boundary-sidecar-raw-two-buffer-export-v0') {
    throw new Error(`unexpected raw export identity: ${capture?.identity || 'missing'}`);
  }
  const grid = capture.grid;
  if (!Array.isArray(grid) || grid.length !== 3 || grid.some(value => !Number.isInteger(value) || value <= 0)) {
    throw new Error(`invalid grid: ${JSON.stringify(grid)}`);
  }
  const cellCount = grid[0] * grid[1] * grid[2];
  const expectedByteLength = cellCount * 4 * Float32Array.BYTES_PER_ELEMENT;

  report.failurePhase = 'validate-inputs';
  const structurePath = join(inputDir, 'structure.f32');
  const metaPath = join(inputDir, 'meta.f32');
  const structureBuffer = readFileSync(structurePath);
  const metaBuffer = readFileSync(metaPath);
  if (capture.fields?.structure?.bytes !== expectedByteLength) {
    throw new Error(`capture structure byte length ${capture.fields?.structure?.bytes} does not match grid byte length ${expectedByteLength}`);
  }
  if (capture.fields?.meta?.bytes !== expectedByteLength) {
    throw new Error(`capture meta byte length ${capture.fields?.meta?.bytes} does not match grid byte length ${expectedByteLength}`);
  }
  if (structureBuffer.byteLength !== expectedByteLength) {
    throw new Error(`structure.f32 byte length ${structureBuffer.byteLength} does not match expected ${expectedByteLength}`);
  }
  if (metaBuffer.byteLength !== expectedByteLength) {
    throw new Error(`meta.f32 byte length ${metaBuffer.byteLength} does not match expected ${expectedByteLength}`);
  }

  const structureValues = new Float32Array(
    structureBuffer.buffer,
    structureBuffer.byteOffset,
    structureBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const metaValues = new Float32Array(
    metaBuffer.buffer,
    metaBuffer.byteOffset,
    metaBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const structureNonFiniteCount = countNonFinite(structureValues);
  const metaNonFiniteCount = countNonFinite(metaValues);
  if (structureNonFiniteCount || metaNonFiniteCount) {
    throw new Error(`raw sidecar contains non-finite values: structure=${structureNonFiniteCount} meta=${metaNonFiniteCount}`);
  }

  report.failurePhase = 'analyze-channels';
  const channels = {
    support: finiteStats(structureValues, 0, cellCount),
    coverage: finiteStats(structureValues, 1, cellCount),
    ridge: finiteStats(structureValues, 2, cellCount),
    footprint: finiteStats(structureValues, 3, cellCount),
    proximity: finiteStats(metaValues, 0, cellCount),
    normalX: finiteStats(metaValues, 1, cellCount),
    normalY: finiteStats(metaValues, 2, cellCount),
    normalZ: finiteStats(metaValues, 3, cellCount),
    normalMagnitude: finiteStats(metaValues, 0, cellCount, (_value, cellIndex) => normalMagnitude(metaValues, cellIndex)),
    supportWeightedFootprint: finiteStats(
      structureValues,
      3,
      cellCount,
      (value, cellIndex) => value * structureValues[cellIndex * 4],
    ),
  };

  report.failurePhase = 'write-projections';
  const projections = {
    support: writeZProjection({ name: 'support', values: structureValues, channelOffset: 0, grid, mode: 'max' }),
    coverage: writeZProjection({ name: 'coverage', values: structureValues, channelOffset: 1, grid, mode: 'max' }),
    ridge: writeZProjection({ name: 'ridge', values: structureValues, channelOffset: 2, grid, mode: 'max' }),
    footprint: writeZProjection({ name: 'footprint', values: structureValues, channelOffset: 3, grid, mode: 'max' }),
    proximity: writeZProjection({ name: 'proximity', values: metaValues, channelOffset: 0, grid, mode: 'max' }),
    normalMagnitude: writeZProjection({
      name: 'normal-magnitude',
      values: metaValues,
      channelOffset: 0,
      grid,
      mode: 'max',
      transform: (_value, cellIndex) => normalMagnitude(metaValues, cellIndex),
    }),
  };
  const depthIntegratedProjections = {
    support: writeZProjection({ name: 'support', values: structureValues, channelOffset: 0, grid, mode: 'sum' }),
    coverage: writeZProjection({ name: 'coverage', values: structureValues, channelOffset: 1, grid, mode: 'sum' }),
    ridge: writeZProjection({ name: 'ridge', values: structureValues, channelOffset: 2, grid, mode: 'sum' }),
    proximity: writeZProjection({ name: 'proximity', values: metaValues, channelOffset: 0, grid, mode: 'sum' }),
    normalMagnitude: writeZProjection({
      name: 'normal-magnitude',
      values: metaValues,
      channelOffset: 0,
      grid,
      mode: 'sum',
      transform: (_value, cellIndex) => normalMagnitude(metaValues, cellIndex),
    }),
    supportWeightedFootprint: writeZProjection({
      name: 'support-weighted-footprint',
      values: structureValues,
      channelOffset: 3,
      grid,
      mode: 'sum',
      transform: (value, cellIndex) => value * structureValues[cellIndex * 4],
    }),
  };

  Object.assign(report, {
    ok: true,
    failurePhase: 'complete',
    identity: capture.identity,
    captureId: capture.captureId,
    effectiveRoute: sourceReport.effectiveRoute,
    backend: sourceReport.backend,
    fallbackReason: sourceReport.fallbackReason ?? null,
    source: {
      exportReportPath: sourceReportPath,
      exportReportSha256: sha256(sourceReportBuffer),
      greenroomMetadataPath: metadataPath,
      greenroomMetadataSha256: sha256(metadataBuffer),
      greenroomJobId: metadata.job_id || null,
    },
    grid,
    cellCount,
    projectionAuthority: 'axis-z-max-projection-v0',
    depthIntegratedProjectionAuthority: 'axis-z-sum-projection-v0',
    files: {
      structure: {
        path: structurePath,
        byteLength: structureBuffer.byteLength,
        sha256: sha256(structureBuffer),
        nonFiniteCount: structureNonFiniteCount,
      },
      meta: {
        path: metaPath,
        byteLength: metaBuffer.byteLength,
        sha256: sha256(metaBuffer),
        nonFiniteCount: metaNonFiniteCount,
      },
    },
    channels,
    projections,
    depthIntegratedProjections,
  });
  writeFileSync(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  writeFileSync(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(report.error);
  process.exitCode = 1;
}
