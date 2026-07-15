import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';

const rendererUrl = new URL('../smoke-gaussian-oracle-renderer.mjs', import.meta.url);
const {
  SMOKE_GAUSSIAN_ORACLE_RENDER_IDENTITY,
  renderSmokeGaussianOracleWitness,
} = await import(rendererUrl);

assert.equal(SMOKE_GAUSSIAN_ORACLE_RENDER_IDENTITY, 'smoke-gaussian-oracle-render-witness-v0');

const gaussianChannels = [
  'positionX', 'positionY', 'positionZ',
  'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ',
  'axis0X', 'axis0Y', 'axis0Z', 'axis1X', 'axis1Y', 'axis1Z', 'axis2X', 'axis2Y', 'axis2Z',
  'radius0', 'radius1', 'radius2',
  'extinctionMass', 'densityWitness', 'temperatureWitness',
  'velocityX', 'velocityY', 'velocityZ', 'sourceVoxelCount',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeTinyPng(path) {
  const width = 8;
  const height = 8;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const hot = x >= 2 && x <= 5 && y >= 1 && y <= 6;
      rgba[offset] = hot ? 180 : 0;
      rgba[offset + 1] = hot ? 180 : 0;
      rgba[offset + 2] = hot ? 180 : 0;
      rgba[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(path, png);
  return png;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

async function writeGaussianArtifact(directory, budget, rows) {
  const values = new Float32Array(rows.length * gaussianChannels.length);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    values.set([
      row.position[0], row.position[1], row.position[2],
      0.01, 0, 0, 0.01, 0, 0.01,
      1, 0, 0, 0, 1, 0, 0, 0, 1,
      row.radius ?? 0.22, row.radius ?? 0.22, row.radius ?? 0.22,
      row.mass, 0.3, 0.1,
      0, 0, 0,
      12,
    ], rowIndex * gaussianChannels.length);
  }
  const bytes = Buffer.from(values.buffer);
  const path = join(directory, `budget-${budget}.gaussians.f32`);
  await writeFile(path, bytes);
  return {
    path,
    sha256: `sha256:${sha256(bytes)}`,
    byteLength: bytes.byteLength,
    dtype: 'float32',
    byteOrder: 'little-endian',
    shape: [rows.length, gaussianChannels.length],
    channelOrder: gaussianChannels,
  };
}

async function writeFitReport(directory, { route = 'native-3d-compute-fluid-raymarch-v0' } = {}) {
  await mkdir(directory, { recursive: true });
  const raymarchPath = join(directory, 'teacher.png');
  const raymarchBytes = await writeTinyPng(raymarchPath);
  const artifact = await writeGaussianArtifact(directory, 2, [
    { position: [0, 0, 0], mass: 4 },
    { position: [0.35, 0.1, 0], mass: 2 },
  ]);
  const manifestPath = join(directory, 'frame.manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({
    schema: 'kaminos.volume.full-grid-field-export.v0',
    identity: 'full-grid-fluid-front-boundary-sidecars-v0',
    status: 'captured',
    completeFieldCoverage: true,
    effectiveRoute: route,
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    backend: 'WebGPU:apple',
    grid: 8,
    worldSpace: {
      coordinateFrame: 'kaminos-volume-world-v0',
      transformAuthority: 'native-volume-grid-world-transform-v0',
      bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
    },
    deterministicReplay: {
      identity: 'deterministic-replay-same-route-controls-fixed-step-v0',
      authority: 'same-route-controls-fixed-step-replay',
      simStepCount: 7,
      completedSteps: 7,
      grid: 8,
      effectiveRoute: route,
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
    },
  }, null, 2)}\n`);
  const reportPath = join(directory, 'oracle-fit-report.json');
  await writeFile(reportPath, `${JSON.stringify({
    schema: 'kaminos.smoke-gaussian-oracle-static-fit-report.v0',
    identity: 'smoke-gaussian-oracle-static-fit-v0',
    status: 'passed',
    teacher: {
      manifestPath,
      manifestIdentity: 'synthetic',
      effectiveRoute: route,
      prototypeIdentity: 'kaminos-volume-prototype-v0',
      backend: 'WebGPU:apple',
      grid: 8,
      worldSpace: {
        coordinateFrame: 'kaminos-volume-world-v0',
        transformAuthority: 'native-volume-grid-world-transform-v0',
        bounds: { minimum: [-1, -1, -1], maximum: [1, 1, 1] },
      },
      activeSmokeVoxelCount: 16,
      totalSmokeExtinction: 6,
      maxSmokeDensity: 0.5,
    },
    requestedBudgets: [2],
    hiddenBudgetCapApplied: false,
    budgetCurve: [{
      requestedBudget: 2,
      activeGaussianCount: 2,
      totalAssignedExtinction: 6,
      extinctionAccounting: {
        teacherTotalExtinction: 6,
        representedExtinction: 6,
        absoluteError: 0,
        relativeError: 0,
      },
      support: { supportLeakageFraction: 0, maxThreeSigmaDiameter: 1.32 },
      artifact,
    }],
  }, null, 2)}\n`);
  return { reportPath, raymarchPath, raymarchSha: `sha256:${sha256(raymarchBytes)}` };
}

const directory = await mkdtemp(join(tmpdir(), 'kaminos-smoke-gaussian-renderer-'));
try {
  const { reportPath, raymarchPath, raymarchSha } = await writeFitReport(join(directory, 'fit'));
  const report = await renderSmokeGaussianOracleWitness({
    fitReportPath: reportPath,
    raymarchPngPath: raymarchPath,
    outDir: join(directory, 'render'),
    budgets: [2],
    extinctionScales: [0.04, 0.08],
  });
  assert.equal(report.identity, SMOKE_GAUSSIAN_ORACLE_RENDER_IDENTITY);
  assert.equal(report.status, 'passed');
  assert.equal(report.teacher.raymarchSha256, raymarchSha);
  assert.equal(report.renderer.cameraAuthority, 'orthographic-world-proxy-not-native-camera-v0');
  assert.equal(report.hiddenBudgetCapApplied, false);
  assert.equal(report.budgetCurve[0].activeGaussianCount, 2);
  assert.ok(report.budgetCurve[0].metrics.renderActivePixels > 0, 'render witness must reject blank Gaussian output');
  assert.ok(report.budgetCurve[0].metrics.lumaMse >= 0);
  assert.ok(existsSync(report.budgetCurve[0].images.renderPngPath));
  assert.ok(existsSync(report.budgetCurve[0].images.diffPngPath));
  assert.ok(existsSync(report.contactSheet.path));
  assert.equal((await readFile(report.contactSheet.path)).readUInt32BE(0), 0x89504e47, 'contact sheet must be a PNG');

  const wrong = await writeFitReport(join(directory, 'wrong'), { route: 'cached-demo-route-v0' });
  await assert.rejects(
    () => renderSmokeGaussianOracleWitness({
      fitReportPath: wrong.reportPath,
      raymarchPngPath: wrong.raymarchPath,
      outDir: join(directory, 'wrong-render'),
      budgets: [2],
    }),
    /wrong effective route/i,
    'wrong or fallback teacher routes must not enter render evidence',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('smoke gaussian oracle renderer contracts passed');
