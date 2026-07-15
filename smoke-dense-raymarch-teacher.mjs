#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { KAMINOS_FLUID_CHANNEL_ORDER } from './smoke-splat-field-hierarchy.mjs';

export const SMOKE_DENSE_RAYMARCH_TEACHER_IDENTITY = 'smoke-dense-state-raymarch-teacher-v0';

const FIT_IDENTITY = 'smoke-gaussian-oracle-static-fit-v0';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE = 'kaminos-volume-prototype-v0';
const SMOKE_CHANNEL = KAMINOS_FLUID_CHANNEL_ORDER.indexOf('smokeDensity');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function encodeLumaPng(width, height, luma) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = y * width + x;
      const target = y * (stride + 1) + 1 + x * 4;
      const value = Math.max(0, Math.min(255, Math.round(luma[source] * 255)));
      raw[target] = value;
      raw[target + 1] = value;
      raw[target + 2] = value;
      raw[target + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function finiteArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) throw new Error(`${label} must contain ${length} finite numbers`);
  return value;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function resolveArtifactPath(anchorPath, artifactPath) {
  return isAbsolute(artifactPath) ? artifactPath : resolve(dirname(anchorPath), artifactPath);
}

function multiplyMatrix4(left, right) {
  const output = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) output[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
    }
  }
  return output;
}

function invertMatrix4(matrix) {
  const rows = Array.from({ length: 4 }, (_, row) => [
    ...Array.from({ length: 4 }, (_, column) => matrix[column * 4 + row]),
    ...Array.from({ length: 4 }, (_, column) => Number(row === column)),
  ]);
  for (let pivotColumn = 0; pivotColumn < 4; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    for (let row = pivotColumn + 1; row < 4; row += 1) {
      if (Math.abs(rows[row][pivotColumn]) > Math.abs(rows[pivotRow][pivotColumn])) pivotRow = row;
    }
    if (Math.abs(rows[pivotRow][pivotColumn]) < 1e-14) throw new Error('camera view-projection matrix is singular');
    [rows[pivotColumn], rows[pivotRow]] = [rows[pivotRow], rows[pivotColumn]];
    const pivot = rows[pivotColumn][pivotColumn];
    for (let column = 0; column < 8; column += 1) rows[pivotColumn][column] /= pivot;
    for (let row = 0; row < 4; row += 1) {
      if (row === pivotColumn) continue;
      const scale = rows[row][pivotColumn];
      for (let column = 0; column < 8; column += 1) rows[row][column] -= scale * rows[pivotColumn][column];
    }
  }
  return Array.from({ length: 16 }, (_, index) => rows[index % 4][4 + Math.floor(index / 4)]);
}

function transformPoint4(matrix, point) {
  return [0, 1, 2, 3].map(row => (
    matrix[row] * point[0]
    + matrix[4 + row] * point[1]
    + matrix[8 + row] * point[2]
    + matrix[12 + row] * point[3]
  ));
}

function unproject(inverseViewProjection, ndcX, ndcY, ndcZ) {
  const homogeneous = transformPoint4(inverseViewProjection, [ndcX, ndcY, ndcZ, 1]);
  if (Math.abs(homogeneous[3]) < 1e-14) throw new Error('camera unprojection produced zero homogeneous weight');
  return homogeneous.slice(0, 3).map(value => value / homogeneous[3]);
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 0)) throw new Error('camera ray direction has zero length');
  return vector.map(value => value / length);
}

function intersectBounds(origin, direction, minimum, maximum) {
  let start = -Infinity;
  let end = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-14) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
      continue;
    }
    const first = (minimum[axis] - origin[axis]) / direction[axis];
    const second = (maximum[axis] - origin[axis]) / direction[axis];
    start = Math.max(start, Math.min(first, second));
    end = Math.min(end, Math.max(first, second));
  }
  start = Math.max(start, 0);
  return end > start ? [start, end] : null;
}

function sampleSmokeTrilinear(field, grid, minimum, maximum, point) {
  const coordinate = point.map((value, axis) => ((value - minimum[axis]) / (maximum[axis] - minimum[axis])) * grid - 0.5);
  const base = coordinate.map(value => Math.floor(value));
  const fraction = coordinate.map((value, axis) => value - base[axis]);
  let density = 0;
  for (let dz = 0; dz <= 1; dz += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = 0; dx <= 1; dx += 1) {
        const x = Math.max(0, Math.min(grid - 1, base[0] + dx));
        const y = Math.max(0, Math.min(grid - 1, base[1] + dy));
        const z = Math.max(0, Math.min(grid - 1, base[2] + dz));
        const weight = (dx ? fraction[0] : 1 - fraction[0])
          * (dy ? fraction[1] : 1 - fraction[1])
          * (dz ? fraction[2] : 1 - fraction[2]);
        const cellIndex = z * grid * grid + y * grid + x;
        density += field[cellIndex * KAMINOS_FLUID_CHANNEL_ORDER.length + SMOKE_CHANNEL] * weight;
      }
    }
  }
  return Math.max(0, density);
}

async function loadSource(fitReportPath) {
  const reportPath = resolve(fitReportPath);
  const report = JSON.parse((await readFile(reportPath)).toString('utf8'));
  if (report.schema !== 'kaminos.smoke-gaussian-oracle-static-fit-report.v0'
    || report.identity !== FIT_IDENTITY || report.status !== 'passed' || report.hiddenBudgetCapApplied !== false) {
    throw new Error('fit report is not a passed uncapped smoke Gaussian oracle source');
  }
  const teacher = report.teacher || {};
  if (teacher.sourceSchema !== 'kaminos.volume.operator-basin-replay.v0') throw new Error('dense raymarch requires a checksum-bound held replay source');
  if (teacher.effectiveRoute !== EXPECTED_ROUTE || teacher.prototypeIdentity !== EXPECTED_PROTOTYPE) throw new Error('dense raymarch source route or prototype mismatch');
  if (typeof teacher.backend !== 'string' || !teacher.backend.startsWith('WebGPU:')) throw new Error('dense raymarch source backend mismatch');
  if (teacher.worldSpace?.transformAuthority !== 'operator-basin-normalized-volume-domain-v0') throw new Error('dense raymarch source lacks held world-space authority');
  const minimum = finiteArray(teacher.worldSpace.bounds?.minimum, 3, 'world minimum');
  const maximum = finiteArray(teacher.worldSpace.bounds?.maximum, 3, 'world maximum');
  const camera = teacher.camera || {};
  finiteArray(camera.position, 3, 'camera position');
  finiteArray(camera.target, 3, 'camera target');
  finiteArray(camera.projectionMatrix, 16, 'camera projectionMatrix');
  finiteArray(camera.matrixWorldInverse, 16, 'camera matrixWorldInverse');
  const cameraIdentity = `sha256:${sha256(Buffer.from(JSON.stringify(camera)))}`;
  if (cameraIdentity !== teacher.cameraIdentity) throw new Error(`camera identity mismatch: ${cameraIdentity} != ${teacher.cameraIdentity || '(missing)'}`);
  const grid = positiveInteger(teacher.grid, 'teacher grid');
  const fluidPath = resolveArtifactPath(reportPath, teacher.fluidPath);
  const fluidBytes = await readFile(fluidPath);
  const expectedByteLength = grid ** 3 * KAMINOS_FLUID_CHANNEL_ORDER.length * Float32Array.BYTES_PER_ELEMENT;
  if (fluidBytes.byteLength !== expectedByteLength) throw new Error(`dense fluid byte length mismatch: ${fluidBytes.byteLength} != ${expectedByteLength}`);
  const fluidIdentity = `sha256:${sha256(fluidBytes)}`;
  if (fluidIdentity !== teacher.fluidIdentity) throw new Error(`fluid identity mismatch: ${fluidIdentity} != ${teacher.fluidIdentity || '(missing)'}`);
  return {
    fitReportPath: reportPath,
    teacher,
    camera,
    cameraIdentity,
    fluidPath,
    fluidIdentity,
    field: new Float32Array(fluidBytes.buffer, fluidBytes.byteOffset, fluidBytes.byteLength / 4),
    grid,
    minimum,
    maximum,
  };
}

async function writeFloatArtifact(path, values) {
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  await writeFile(path, bytes);
  return {
    path,
    sha256: `sha256:${sha256(bytes)}`,
    dtype: 'float32',
    byteOrder: 'little-endian',
    shape: [values.length],
    byteLength: bytes.byteLength,
  };
}

export async function renderDenseSmokeRaymarchTeacher({
  fitReportPath,
  outDir,
  width = 640,
  height = 455,
  samplesPerCell = 1,
} = {}) {
  if (!fitReportPath) throw new Error('fitReportPath is required');
  if (!outDir) throw new Error('outDir is required');
  const renderWidth = positiveInteger(width, 'width');
  const renderHeight = positiveInteger(height, 'height');
  const requestedSamplesPerCell = Number(samplesPerCell);
  if (!(requestedSamplesPerCell > 0) || !Number.isFinite(requestedSamplesPerCell)) throw new Error('samplesPerCell must be positive and finite');
  const startedAt = performance.now();
  await mkdir(outDir, { recursive: true });
  const source = await loadSource(fitReportPath);
  const sourceLoadedAt = performance.now();
  const viewProjection = multiplyMatrix4(source.camera.projectionMatrix, source.camera.matrixWorldInverse);
  const inverseViewProjection = invertMatrix4(viewProjection);
  const cellSize = source.minimum.map((value, axis) => (source.maximum[axis] - value) / source.grid);
  const stepWorld = Math.min(...cellSize) / requestedSamplesPerCell;
  const opticalDepth = new Float32Array(renderWidth * renderHeight);
  const transmittance = new Float32Array(opticalDepth.length);
  const linearRadiance = new Float32Array(opticalDepth.length);
  let maximumOpticalDepth = 0;
  let nonzeroOpticalPixels = 0;
  let totalSamples = 0;
  for (let y = 0; y < renderHeight; y += 1) {
    const ndcY = 1 - ((y + 0.5) / renderHeight) * 2;
    for (let x = 0; x < renderWidth; x += 1) {
      const ndcX = ((x + 0.5) / renderWidth) * 2 - 1;
      const far = unproject(inverseViewProjection, ndcX, ndcY, 1);
      const direction = normalize(far.map((value, axis) => value - source.camera.position[axis]));
      const interval = intersectBounds(source.camera.position, direction, source.minimum, source.maximum);
      const index = y * renderWidth + x;
      if (!interval) {
        transmittance[index] = 1;
        continue;
      }
      let depth = 0;
      for (let distance = interval[0]; distance < interval[1]; distance += stepWorld) {
        const segment = Math.min(stepWorld, interval[1] - distance);
        const midpoint = distance + segment / 2;
        const point = source.camera.position.map((value, axis) => value + direction[axis] * midpoint);
        depth += sampleSmokeTrilinear(source.field, source.grid, source.minimum, source.maximum, point) * segment;
        totalSamples += 1;
      }
      opticalDepth[index] = depth;
      transmittance[index] = Math.exp(-depth);
      linearRadiance[index] = 1 - transmittance[index];
      maximumOpticalDepth = Math.max(maximumOpticalDepth, depth);
      if (depth > 1e-8) nonzeroOpticalPixels += 1;
    }
  }
  const raymarchCompletedAt = performance.now();
  if (maximumOpticalDepth <= 0 || nonzeroOpticalPixels === 0) throw new Error('blank optical output from dense raymarch teacher');
  const opticalDepthPath = join(outDir, 'optical-depth.f32');
  const transmittancePath = join(outDir, 'transmittance.f32');
  const linearRadiancePath = join(outDir, 'linear-smoke-radiance.f32');
  const displayPngPath = join(outDir, 'dense-raymarch-smoke.png');
  const [opticalArtifact, transmittanceArtifact, radianceArtifact] = await Promise.all([
    writeFloatArtifact(opticalDepthPath, opticalDepth),
    writeFloatArtifact(transmittancePath, transmittance),
    writeFloatArtifact(linearRadiancePath, linearRadiance),
  ]);
  const pngBytes = encodeLumaPng(renderWidth, renderHeight, linearRadiance);
  await writeFile(displayPngPath, pngBytes);
  const artifactsWrittenAt = performance.now();
  const centerIndex = Math.floor(renderHeight / 2) * renderWidth + Math.floor(renderWidth / 2);
  const report = {
    schema: 'kaminos.smoke-dense-raymarch-teacher-report.v0',
    identity: SMOKE_DENSE_RAYMARCH_TEACHER_IDENTITY,
    status: 'passed',
    createdAt: new Date().toISOString(),
    source: {
      fitReportPath: source.fitReportPath,
      manifestIdentity: source.teacher.manifestIdentity,
      fluidPath: source.fluidPath,
      fluidIdentity: source.fluidIdentity,
      cameraIdentity: source.cameraIdentity,
      effectiveRoute: source.teacher.effectiveRoute,
      prototypeIdentity: source.teacher.prototypeIdentity,
      backend: source.teacher.backend,
      grid: source.grid,
      worldSpace: source.teacher.worldSpace,
      camera: source.camera,
    },
    raymarch: {
      identity: 'cpu-dense-smoke-optical-depth-ray-integral-v0',
      interpolation: 'trilinear-cell-centered-smoke-density-v0',
      requestedSamplesPerCell,
      effectiveSamplesPerCell: requestedSamplesPerCell,
      stepWorld,
      width: renderWidth,
      height: renderHeight,
      totalSamples,
      extinctionCoefficient: 1,
      radianceModel: 'single-channel-one-minus-transmittance-v0',
      productionCompositorAuthority: false,
    },
    pixelStats: {
      blank: false,
      nonzeroOpticalPixels,
      maximumOpticalDepth,
      centerOpticalDepth: opticalDepth[centerIndex],
      cornerOpticalDepth: opticalDepth[0],
    },
    costs: {
      authority: 'cpu-wall-clock-performance-now-v0',
      sourceLoadAndValidateMs: sourceLoadedAt - startedAt,
      raymarchMs: raymarchCompletedAt - sourceLoadedAt,
      artifactWriteMs: artifactsWrittenAt - raymarchCompletedAt,
      totalMs: artifactsWrittenAt - startedAt,
    },
    artifacts: {
      opticalDepth: { ...opticalArtifact, shape: [renderHeight, renderWidth] },
      transmittance: { ...transmittanceArtifact, shape: [renderHeight, renderWidth] },
      linearRadiance: { ...radianceArtifact, shape: [renderHeight, renderWidth] },
      displayPng: {
        path: displayPngPath,
        sha256: `sha256:${sha256(pngBytes)}`,
        width: renderWidth,
        height: renderHeight,
        byteLength: pngBytes.byteLength,
      },
    },
  };
  const reportPath = join(outDir, 'dense-raymarch-teacher-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  report.reportPath = reportPath;
  return report;
}

export async function writeDenseSmokeRaymarchFailureReport({
  reportPath,
  failurePhase,
  fitReportPath,
  lastTrustworthyEvidence = null,
  cause,
} = {}) {
  if (!reportPath) throw new Error('reportPath is required');
  const report = {
    schema: 'kaminos.smoke-dense-raymarch-teacher-report.v0',
    identity: SMOKE_DENSE_RAYMARCH_TEACHER_IDENTITY,
    status: 'failed',
    failurePhase: String(failurePhase || 'unknown'),
    fitReportPath: fitReportPath ? resolve(fitReportPath) : null,
    lastTrustworthyEvidence,
    cause: String(cause || 'unknown failure'),
    createdAt: new Date().toISOString(),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--')) continue;
    if (value && !value.startsWith('--')) {
      values.set(key, value);
      index += 1;
    } else values.set(key, true);
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.get('--out-dir');
  try {
    const report = await renderDenseSmokeRaymarchTeacher({
      fitReportPath: args.get('--fit-report'),
      outDir,
      width: Number(args.get('--width') || 640),
      height: Number(args.get('--height') || 455),
      samplesPerCell: Number(args.get('--samples-per-cell') || 1),
    });
    console.log(JSON.stringify({ status: report.status, reportPath: report.reportPath, costs: report.costs, pixelStats: report.pixelStats }, null, 2));
  } catch (error) {
    if (outDir) {
      await writeDenseSmokeRaymarchFailureReport({
        reportPath: join(outDir, 'dense-raymarch-teacher-report.json'),
        failurePhase: 'dense-raymarch',
        fitReportPath: args.get('--fit-report'),
        cause: error?.message || String(error),
      });
    }
    throw error;
  }
}
